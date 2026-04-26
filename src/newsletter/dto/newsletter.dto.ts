import { IsEmail } from 'class-validator';

export class SubscribeDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}

export class UnsubscribeDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}
