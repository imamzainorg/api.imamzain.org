import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoleDto, RoleTranslationDto, UpdateRoleDto } from './role.dto';

const errorsFor = async (dto: object) => (await validate(dto)).map((e) => e.property);
const translation = { lang: 'ar', title: 'مدير' };

describe('role DTOs', () => {
  describe('CreateRoleDto', () => {
    it('trims the name', () => {
      expect(plainToInstance(CreateRoleDto, { name: '  editor ', translations: [translation] }).name).toBe('editor');
    });

    it('checks the length bounds AFTER trimming', async () => {
      const dto = plainToInstance(CreateRoleDto, { name: ' a ', translations: [translation] });

      expect(await errorsFor(dto)).toContain('name');
    });

    it('validates nested translations', async () => {
      const dto = plainToInstance(CreateRoleDto, {
        name: 'editor',
        translations: [{ lang: 'ar', title: 't'.repeat(201) }],
      });

      expect((await validate(dto))[0].children?.length).toBeGreaterThan(0);
    });
  });

  describe('UpdateRoleDto', () => {
    it('trims the name', () => {
      expect(plainToInstance(UpdateRoleDto, { name: ' reviewer ' }).name).toBe('reviewer');
    });

    it('bounds the name at 50 characters', async () => {
      expect(await errorsFor(plainToInstance(UpdateRoleDto, { name: 'r'.repeat(51) }))).toContain('name');
    });
  });

  describe('RoleTranslationDto', () => {
    it('bounds the title at 200 and the description at 1000 characters', async () => {
      expect(await errorsFor(plainToInstance(RoleTranslationDto, { lang: 'ar', title: 't'.repeat(200) }))).toEqual([]);
      expect(await errorsFor(plainToInstance(RoleTranslationDto, { lang: 'ar', title: 't'.repeat(201) }))).toContain('title');
      expect(
        await errorsFor(plainToInstance(RoleTranslationDto, { lang: 'ar', title: 'x', description: 'd'.repeat(1000) })),
      ).toEqual([]);
      expect(
        await errorsFor(plainToInstance(RoleTranslationDto, { lang: 'ar', title: 'x', description: 'd'.repeat(1001) })),
      ).toContain('description');
    });
  });
});
