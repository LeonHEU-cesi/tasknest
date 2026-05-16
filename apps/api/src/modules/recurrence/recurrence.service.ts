import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RRule } from 'rrule';
import { PrismaService } from '../../db/prisma.service';
import type { SetRecurrenceDto } from './dto/set-recurrence.dto';

// US-RE-01 — Règles RRULE scopées au propriétaire, attachées à une tâche
// "modèle" (occurrenceDate null). La génération d'occurrences = US-RE-02.
@Injectable()
export class RecurrenceService {
  constructor(private readonly prisma: PrismaService) {}

  // Valide une RRULE RFC 5545 ; rejette en 400 si non parsable.
  static parseRRule(rrule: string): RRule {
    try {
      return RRule.fromString(rrule.startsWith('RRULE:') ? rrule : `RRULE:${rrule}`);
    } catch {
      throw new BadRequestException('invalid-rrule');
    }
  }

  private async ownedTask(ownerId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, ownerId } });
    if (!task) throw new NotFoundException('task-not-found');
    return task;
  }

  // Crée/attache une règle à la tâche modèle (remplace l'éventuelle règle).
  async setForTask(ownerId: string, taskId: string, dto: SetRecurrenceDto) {
    await this.ownedTask(ownerId, taskId);
    RecurrenceService.parseRRule(dto.rrule);

    const rule = await this.prisma.recurrenceRule.create({
      data: {
        ownerId,
        rrule: dto.rrule,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
      },
    });
    return this.prisma.task.update({
      where: { id: taskId },
      data: { recurrenceRuleId: rule.id, occurrenceDate: null },
      include: { recurrenceRule: true },
    });
  }

  async removeFromTask(ownerId: string, taskId: string) {
    await this.ownedTask(ownerId, taskId);
    await this.prisma.task.update({
      where: { id: taskId },
      data: { recurrenceRuleId: null },
    });
  }

  listRules(ownerId: string) {
    return this.prisma.recurrenceRule.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
