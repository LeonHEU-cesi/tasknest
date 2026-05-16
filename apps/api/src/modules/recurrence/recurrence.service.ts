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

  private async ownedRule(ownerId: string, ruleId: string) {
    const rule = await this.prisma.recurrenceRule.findFirst({ where: { id: ruleId, ownerId } });
    if (!rule) throw new NotFoundException('rule-not-found');
    return rule;
  }

  // Purge les occurrences futures non-exception (régénérées au prochain run).
  private async purgeFutureOccurrences(ruleId: string) {
    await this.prisma.task.deleteMany({
      where: {
        recurrenceRuleId: ruleId,
        occurrenceDate: { not: null, gte: new Date() },
        recurrenceException: false,
      },
    });
  }

  // US-RE-03 — édition de la série : maj règle + purge des occurrences
  // futures non-exception (rebâties au prochain run avec la nouvelle règle).
  async updateRule(
    ownerId: string,
    ruleId: string,
    dto: { rrule?: string; endAt?: string },
  ) {
    await this.ownedRule(ownerId, ruleId);
    if (dto.rrule) RecurrenceService.parseRRule(dto.rrule);
    const updated = await this.prisma.recurrenceRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.rrule ? { rrule: dto.rrule } : {}),
        ...(dto.endAt !== undefined ? { endAt: dto.endAt ? new Date(dto.endAt) : null } : {}),
      },
    });
    await this.purgeFutureOccurrences(ruleId);
    return updated;
  }

  // US-RE-04 — suppression de la série : purge des occurrences futures
  // non-exception puis suppression de la règle (les tâches restantes —
  // modèle, passées, exceptions — voient recurrenceRuleId mis à NULL).
  async deleteSeries(ownerId: string, ruleId: string) {
    await this.ownedRule(ownerId, ruleId);
    await this.purgeFutureOccurrences(ruleId);
    await this.prisma.recurrenceRule.delete({ where: { id: ruleId } });
  }
}
