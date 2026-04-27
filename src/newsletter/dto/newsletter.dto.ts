import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class SubscribeDto {
  @ApiProperty({ example: 'reader@example.com', format: 'email' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}

export class UnsubscribeDto {
  @ApiProperty({ example: 'reader@example.com', format: 'email' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}
