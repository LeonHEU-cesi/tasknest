import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';

export interface PublicProfile {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  timezone: string;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('user-not-found');
    return this.toPublic(user);
  }

  async updateProfile(id: string, input: UpdateProfileDto): Promise<PublicProfile> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        displayName: input.displayName,
        locale: input.locale,
        timezone: input.timezone,
        avatarUrl: input.avatarUrl,
      },
    });
    return this.toPublic(user);
  }

  private toPublic(user: {
    id: string;
    email: string;
    displayName: string;
    locale: string;
    timezone: string;
    avatarUrl: string | null;
    emailVerifiedAt: Date | null;
    createdAt: Date;
  }): PublicProfile {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      timezone: user.timezone,
      avatarUrl: user.avatarUrl,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    };
  }
}
