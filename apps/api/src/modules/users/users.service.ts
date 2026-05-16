import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';

// US-US-01 — Profil public exposé par GET/PATCH /me. Forme alignée sur le
// schéma Better Auth (`name`/`image`/`emailVerified`).
export interface PublicProfile {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
  image: string | null;
  emailVerified: boolean;
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
        name: input.name,
        locale: input.locale,
        timezone: input.timezone,
        image: input.image,
      },
    });
    return this.toPublic(user);
  }

  private toPublic(user: {
    id: string;
    email: string;
    name: string;
    locale: string;
    timezone: string;
    image: string | null;
    emailVerified: boolean;
    createdAt: Date;
  }): PublicProfile {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      timezone: user.timezone,
      image: user.image,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };
  }
}
