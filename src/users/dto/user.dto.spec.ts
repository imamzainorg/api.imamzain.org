import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminResetPasswordDto, CreateUserDto, UpdateUserDto } from './user.dto';

const parse = <T extends object>(cls: new () => T, body: Record<string, unknown>) => plainToInstance(cls, body);
const errorsFor = async (dto: object) => (await validate(dto)).map((e) => e.property);

describe('user DTOs', () => {
  describe('CreateUserDto', () => {
    it('trims the username', () => {
      expect(parse(CreateUserDto, { username: '  editor01 ', password: 'a-long-password' }).username).toBe('editor01');
    });

    it('never trims the password', () => {
      expect(parse(CreateUserDto, { username: 'editor01', password: '  spaced password  ' }).password).toBe(
        '  spaced password  ',
      );
    });

    it('checks the length bounds AFTER trimming', async () => {
      const tooShort = parse(CreateUserDto, { username: '  ab  ', password: 'a-long-password' });

      expect(await errorsFor(tooShort)).toContain('username');
    });

    it('accepts a name up to the maximum and refuses one beyond it', async () => {
      expect(await errorsFor(parse(CreateUserDto, { username: 'a'.repeat(50), password: 'a-long-password' }))).toEqual([]);
      expect(await errorsFor(parse(CreateUserDto, { username: 'a'.repeat(51), password: 'a-long-password' }))).toContain(
        'username',
      );
    });

    it('bounds the password at 128 characters', async () => {
      expect(await errorsFor(parse(CreateUserDto, { username: 'editor01', password: 'p'.repeat(129) }))).toContain(
        'password',
      );
    });
  });

  describe('UpdateUserDto', () => {
    it('trims the username', () => {
      expect(parse(UpdateUserDto, { username: ' editor02 ' }).username).toBe('editor02');
    });

    it('leaves an omitted username omitted', async () => {
      const dto = parse(UpdateUserDto, {});

      expect(dto.username).toBeUndefined();
      expect(await errorsFor(dto)).toEqual([]);
    });
  });

  describe('AdminResetPasswordDto', () => {
    it('bounds the new password at 128 characters and never trims it', async () => {
      expect(parse(AdminResetPasswordDto, { new_password: '  padded-secret  ' }).new_password).toBe('  padded-secret  ');
      expect(await errorsFor(parse(AdminResetPasswordDto, { new_password: 'p'.repeat(129) }))).toContain('new_password');
    });
  });
});
