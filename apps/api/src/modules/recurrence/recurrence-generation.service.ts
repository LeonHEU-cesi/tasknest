import { Injectable, Logger } from '@nestjs/common';
import { RRule } from 'rrule';
import { PrismaService } from '../../db/prisma.service';

// US-RE-02 — Génère les occurrences à venir (J+1 → J+horizon) des tâches
// modèles récurrentes. Idempotent : `createMany({ skipDuplicates })` +
// la contrainte unique (recurrenceRuleId, occurrenceDate) ⇒ aucun doublon
// au rerun, et les exceptions (instances éditées) ne sont pas écrasées.
@Injectable()
export class RecurrenceGenerationService {
  private readonly logger = new Logger(RecurrenceGenerationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // startOfDay UTC, neutre vis-à-vis du fuseau pour la déduplication.
  private static day(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
  }

  /**
   * @param ownerId si fourni, limite aux modèles de cet utilisateur (trigger
   *   manuel / test) ; sinon tous (cron système).
   * @returns nombre d'occurrences créées.
   */
  async generateUpcoming(now = new Date(), horizonDays = 30, ownerId?: string): Promise<number> {
    // Fenêtre = jours entiers J+1 (00:00) → J+horizon (23:59:59.999), pour
    // ne pas dépendre de l'heure du dtstart (sinon off-by-one en bord).
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth();
    const d = now.getUTCDate();
    const from = new Date(Date.UTC(y, mo, d + 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(y, mo, d + horizonDays, 23, 59, 59, 999));

    const templates = await this.prisma.task.findMany({
      where: {
        recurrenceRuleId: { not: null },
        occurrenceDate: null,
        archivedAt: null,
        ...(ownerId ? { ownerId } : {}),
      },
      include: { recurrenceRule: true },
    });

    let created = 0;
    for (const tpl of templates) {
      const rule = tpl.recurrenceRule;
      if (!rule) continue;

      let occurrences: Date[];
      try {
        const parsed = RRule.fromString(
          rule.rrule.startsWith('RRULE:') ? rule.rrule : `RRULE:${rule.rrule}`,
        );
        const anchor = tpl.dueAt ?? tpl.startAt ?? rule.createdAt;
        const withDtstart = new RRule({ ...parsed.origOptions, dtstart: anchor });
        occurrences = withDtstart.between(from, to, true);
      } catch (error) {
        this.logger.warn(`RRULE invalide pour la règle ${rule.id}: ${String(error)}`);
        continue;
      }

      const hardEnd = rule.endAt ? rule.endAt.getTime() : Infinity;
      const data = occurrences
        .filter((occ) => occ.getTime() <= hardEnd)
        .map((occ) => {
          const occurrenceDate = RecurrenceGenerationService.day(occ);
          return {
            listId: tpl.listId,
            ownerId: tpl.ownerId,
            recurrenceRuleId: rule.id,
            occurrenceDate,
            title: tpl.title,
            description: tpl.description,
            priority: tpl.priority,
            estimatedMinutes: tpl.estimatedMinutes,
            dueAt: occurrenceDate,
          };
        });

      if (data.length > 0) {
        const res = await this.prisma.task.createMany({ data, skipDuplicates: true });
        created += res.count;
      }
    }
    return created;
  }
}
