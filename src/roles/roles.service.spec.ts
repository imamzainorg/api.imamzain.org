import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { RolesService } from "./roles.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";

const baseRoleWithRelations = {
  id: "role-1",
  name: "Admin",
  role_translations: [
    { role_id: "role-1", lang: "ar", title: "مدير", description: null },
    { role_id: "role-1", lang: "en", title: "Admin", description: null },
  ],
  role_permissions: [
    {
      role_id: "role-1",
      permission_id: "perm-1",
      permissions: {
        id: "perm-1",
        name: "posts:create",
        permission_translations: [
          { permission_id: "perm-1", lang: "ar", title: "إنشاء منشور", description: null },
        ],
      },
    },
  ],
};

describe("RolesService", () => {
  let service: RolesService;
  let prisma: any;

  const mockTx = {
    roles: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    role_translations: {
      createMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    role_permissions: { deleteMany: jest.fn() },
    user_roles: { count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: PrismaService,
          useValue: {
            users: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            roles: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
            },
            role_translations: {
              createMany: jest.fn(),
              upsert: jest.fn(),
              deleteMany: jest.fn(),
            },
            role_permissions: {
              upsert: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            user_roles: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
            permissions: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("findAll", () => {
    it("returns roles with flat permissions[] derived from role_permissions join", async () => {
      prisma.roles.findMany.mockResolvedValue([baseRoleWithRelations]);

      const result = await service.findAll("ar", 1, 10);

      expect(prisma.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            role_translations: true,
            role_permissions: expect.any(Object),
          }),
        }),
      );
      const role = result.data.items[0];
      expect(role.id).toBe("role-1");
      expect(role.permissions).toHaveLength(1);
      expect(role.permissions[0]).toEqual(
        expect.objectContaining({ id: "perm-1", name: "posts:create" }),
      );
      // role_permissions join object is unwrapped — consumers see flat permissions only.
      expect(role).not.toHaveProperty("role_permissions");
    });

    it("resolves translation based on Accept-Language", async () => {
      prisma.roles.findMany.mockResolvedValue([baseRoleWithRelations]);

      const result = await service.findAll("en", 1, 10);

      expect(result.data.items[0].translation?.lang).toBe("en");
    });
  });

  describe("findOne", () => {
    it("returns role with flat permissions and resolved translation", async () => {
      prisma.roles.findUnique.mockResolvedValue(baseRoleWithRelations);

      const result = await service.findOne("role-1", "ar");

      expect(result.data.id).toBe("role-1");
      expect(result.data.permissions).toHaveLength(1);
      expect(result.data.translation?.lang).toBe("ar");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(service.findOne("ghost", null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates role inside a transaction and returns hydrated detail", async () => {
      prisma.roles.findFirst.mockResolvedValue(null);
      mockTx.roles.create.mockResolvedValue({ id: "role-1", name: "Admin" });
      mockTx.role_translations.createMany.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      prisma.roles.findUnique.mockResolvedValue(baseRoleWithRelations);

      const result = await service.create(
        { name: "Admin", translations: [{ lang: "ar", title: "مدير" }] },
        "actor-1",
        null,
      );

      expect(mockTx.roles.create).toHaveBeenCalled();
      expect(mockTx.role_translations.createMany).toHaveBeenCalled();
      expect(result.data.id).toBe("role-1");
      // Response carries the full flat permission list, even when newly created.
      expect(Array.isArray(result.data.permissions)).toBe(true);
    });

    it("throws ConflictException when name already exists", async () => {
      prisma.roles.findFirst.mockResolvedValue({ id: "role-1", name: "Admin" });

      await expect(
        service.create({ name: "Admin", translations: [] }, "actor-1", null),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("update", () => {
    it("updates role name and upserts translations, returns hydrated detail", async () => {
      prisma.roles.findUnique
        .mockResolvedValueOnce({ id: "role-1", name: "Admin" }) // initial lookup
        .mockResolvedValueOnce(baseRoleWithRelations); // hydrate after update
      prisma.roles.findFirst.mockResolvedValue(null);
      mockTx.roles.update.mockResolvedValue({ id: "role-1", name: "SuperAdmin" });
      mockTx.role_translations.upsert.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.update(
        "role-1",
        {
          name: "SuperAdmin",
          translations: [{ lang: "ar", title: "مدير عام" }],
        },
        "actor-1",
        null,
      );

      expect(mockTx.roles.update).toHaveBeenCalled();
      expect(result.message).toBe("Role updated");
      expect(result.data.permissions).toBeDefined();
    });

    it("throws NotFoundException when role not found", async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(service.update("ghost", {}, "actor-1", null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ConflictException when new name already taken", async () => {
      prisma.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      prisma.roles.findFirst.mockResolvedValue({
        id: "role-2",
        name: "Editor",
      });

      await expect(
        service.update("role-1", { name: "Editor" }, "actor-1", null),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("delete", () => {
    it("deletes role and its translations + permissions in a transaction", async () => {
      mockTx.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      mockTx.user_roles.count.mockResolvedValue(0);
      mockTx.role_permissions.deleteMany.mockResolvedValue({});
      mockTx.role_translations.deleteMany.mockResolvedValue({});
      mockTx.roles.delete.mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      const result = await service.delete("role-1", "actor-1");

      expect(mockTx.role_permissions.deleteMany).toHaveBeenCalled();
      expect(mockTx.role_translations.deleteMany).toHaveBeenCalled();
      expect(mockTx.roles.delete).toHaveBeenCalled();
      expect(result.message).toBe("Role deleted");
      expect(result.data).toBeNull();
    });

    it("throws NotFoundException when role not found", async () => {
      mockTx.roles.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await expect(service.delete("ghost", "actor-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ConflictException when role is assigned to users", async () => {
      mockTx.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      mockTx.user_roles.count.mockResolvedValue(3);
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));

      await expect(service.delete("role-1", "actor-1")).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("assignPermission", () => {
    it("upserts role_permissions record and returns hydrated role", async () => {
      prisma.roles.findUnique
        .mockResolvedValueOnce({ id: "role-1", name: "Admin" }) // initial lookup
        .mockResolvedValueOnce(baseRoleWithRelations); // hydrate after assign
      prisma.role_permissions.upsert.mockResolvedValue({});

      const result = await service.assignPermission(
        "role-1",
        { permissionId: "perm-1" },
        "actor-1",
        null,
      );

      expect(prisma.role_permissions.upsert).toHaveBeenCalled();
      expect(result.message).toBe("Permission assigned");
      expect(result.data.permissions).toBeDefined();
    });

    it("throws NotFoundException when role not found", async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.assignPermission(
          "ghost",
          { permissionId: "perm-1" },
          "actor-1",
          null,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("removePermission", () => {
    it("deletes role_permissions record and returns hydrated role", async () => {
      prisma.roles.findUnique
        .mockResolvedValueOnce({ id: "role-1", name: "Admin" }) // initial lookup
        .mockResolvedValueOnce(baseRoleWithRelations); // hydrate after remove
      prisma.role_permissions.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.removePermission(
        "role-1",
        "perm-1",
        "actor-1",
        null,
      );

      expect(prisma.role_permissions.deleteMany).toHaveBeenCalled();
      expect(result.message).toBe("Permission removed");
      expect(result.data.permissions).toBeDefined();
    });

    it("throws NotFoundException when role not found", async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.removePermission("ghost", "perm-1", "actor-1", null),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when permission is not assigned", async () => {
      prisma.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      prisma.role_permissions.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.removePermission("role-1", "perm-1", "actor-1", null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("findAllPermissions", () => {
    it("returns permissions with all translations and a resolved translation", async () => {
      const perm = {
        id: "p1",
        name: "users:read",
        permission_translations: [
          { permission_id: "p1", lang: "ar", title: "عرض المستخدمين", description: null },
          { permission_id: "p1", lang: "en", title: "Read users", description: null },
        ],
      };
      prisma.permissions.findMany.mockResolvedValue([perm]);

      const result = await service.findAllPermissions("ar", 1, 10);

      expect(prisma.permissions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { permission_translations: true },
        }),
      );
      expect(result.data.items[0].permission_translations).toHaveLength(2);
      expect(result.data.items[0].translation?.lang).toBe("ar");
    });
  });
});
