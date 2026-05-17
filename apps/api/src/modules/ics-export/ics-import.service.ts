import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { parseICalendar } from '../sync/caldav-ical.mapper';
import type { ConfirmIcsDto, ImportIcsDto } from './dto/import-ics.dto';

const MAX_BYTES = 2_000_000;
const MAX_EVENTS = 1000;
const FETCH_TIMEOUT_MS = 5000;

export interface ImportCandidate {
  title: string;
  dueAt: string | null;
  description: string | null;
}

// US-SY-12 — Import .ics one-shot (prévisualisation + confirmation). Pas de
// mapping de sync : c'est une création de tâches one-shot. La récupération
// d'URL distante est protégée contre le SSRF (l'opérateur tient à la
// sécurité de son infra auto-hébergée).
@Injectable()
export class IcsImportService {
  private readonly logger = new Logger(IcsImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Bloque localhost / IP privées / metadata cloud (anti-SSRF). Résiduel :
  // DNS-rebinding (hostname public résolvant vers une IP interne) non
  // couvert — acceptable pour un import déclenché par l'utilisateur lui-même.
  private assertSafeUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('Invalid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('Only http(s) URLs are allowed');
    }
    const host = url.hostname.toLowerCase();
    const blocked =
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '169.254.169.254' || // metadata
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80');
    if (blocked) {
      throw new BadRequestException('URL host is not allowed');
    }
    return url;
  }

  private async fetchRemoteIcs(rawUrl: string): Promise<string> {
    const url = this.assertSafeUrl(rawUrl);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: 'error', // pas de rebond vers une cible interne
        signal: ctrl.signal,
        headers: { accept: 'text/calendar, text/plain, */*' },
      });
      if (!res.ok) {
        throw new BadRequestException(`Could not fetch the calendar (${res.status})`);
      }
      const text = await res.text();
      if (text.length > MAX_BYTES) {
        throw new BadRequestException('Calendar file too large');
      }
      return text;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(`Fetch ICS distant échoué: ${String(e)}`);
      throw new BadRequestException('Could not fetch the remote calendar');
    } finally {
      clearTimeout(timer);
    }
  }

  private async rawFrom(dto: ImportIcsDto): Promise<string> {
    if (dto.ics && dto.ics.trim()) return dto.ics;
    if (dto.url) return this.fetchRemoteIcs(dto.url);
    throw new BadRequestException('Provide either "ics" content or a "url"');
  }

  private toCandidates(ics: string): ImportCandidate[] {
    return parseICalendar(ics)
      .map((e) => ({
        title: (e.summary ?? '').trim() || '(untitled)',
        dueAt: e.startIso ?? null,
        description: e.description ?? null,
      }))
      // Un VEVENT sans titre ni date n'a aucun intérêt comme tâche.
      .filter((c) => c.title !== '(untitled)' || c.dueAt)
      .slice(0, MAX_EVENTS);
  }

  async preview(
    dto: ImportIcsDto,
  ): Promise<{ count: number; events: ImportCandidate[] }> {
    const events = this.toCandidates(await this.rawFrom(dto));
    return { count: events.length, events };
  }

  async confirm(
    userId: string,
    dto: ConfirmIcsDto,
  ): Promise<{ created: number }> {
    const list = await this.prisma.list.findFirst({
      where: { id: dto.listId, ownerId: userId },
    });
    if (!list) throw new NotFoundException('List not found');

    const candidates = this.toCandidates(await this.rawFrom(dto));
    if (candidates.length === 0) return { created: 0 };

    const res = await this.prisma.task.createMany({
      data: candidates.map((c) => ({
        listId: list.id,
        ownerId: userId,
        title: c.title.slice(0, 240),
        description: c.description,
        dueAt: c.dueAt ? new Date(c.dueAt) : null,
      })),
    });
    return { created: res.count };
  }
}
