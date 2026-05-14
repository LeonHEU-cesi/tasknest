import { IsString, Length } from 'class-validator';

export class VerifyEmailRequestDto {
  @IsString()
  @Length(10, 256)
  token!: string;
}
