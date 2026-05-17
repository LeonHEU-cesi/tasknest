import { IsString, Length } from 'class-validator';

// US-CO-01 — Corps d'un commentaire (création / édition).
export class CommentBodyDto {
  @IsString()
  @Length(1, 5000)
  body!: string;
}
