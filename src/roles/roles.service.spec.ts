import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
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

// Actor for the grant/revoke tests: holds the permission the fixtures use, so
// the privilege-envelope guard passes on the happy paths.
const actor = { id: "actor-1", username: "admin", permissions: ["posts:create", "roles:update"] };

describe("RolesService", () => {
  let service: RolesService;
  let prisma: any;
  let audit: any;

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
    // The row lock delete() takes before counting assignments.
    $queryRaw: jest.fn().mockResolvedValue([{ id: "role-1" }]),
    // Read by the last-administrator guard inside removePermission's transaction.
    permissions: { count: jest.fn().mockResolvedValue(0) },
    users: { findMany: jest.fn().mockResolvedValue([]) },
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
            permissions: {
              findMany: jest.fn(),
              findUnique: jest.fn().mockResolvedValue({ id: "perm-1", name: "posts:create" }),
              count: jest.fn().mockResolvedValue(0),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn(),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockTx.$queryRaw.mockResolvedValue([{ id: "role-1" }]);
    mockTx.permissions.count.mockResolvedValue(0);
    mockTx.users.findMany.mockResolvedValue([]);
  });

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

    it("looks for an existing role with the same name in ANY letter case", async () => {
      prisma.roles.findFirst.mockResolvedValue(null);
      mockTx.roles.create.mockResolvedValue({ id: "role-1", name: "Admin" });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      prisma.roles.findUnique.mockResolvedValue(baseRoleWithRelations);

      await service.create({ name: "Admin", translations: [{ lang: "ar", title: "مدير" }] }, "actor-1", null);

      expect(prisma.roles.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: "Admin", mode: "insensitive" } },
        select: { id: true },
      });
    });

    it("rejects a case-variant of an existing role with the same 409 as an exact clash", async () => {
      prisma.roles.findFirst.mockResolvedValue({ id: "role-1", name: "Admin" });

      const err = await service
        .create({ name: "admin", translations: [{ lang: "ar", title: "x" }] }, "actor-1", null)
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe("A role with that name already exists");
      expect(mockTx.roles.create).not.toHaveBeenCalled();
    });

    it("stores the trimmed name", async () => {
      prisma.roles.findFirst.mockResolvedValue(null);
      mockTx.roles.create.mockResolvedValue({ id: "role-1", name: "editor" });
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      prisma.roles.findUnique.mockResolvedValue(baseRoleWithRelations);

      await service.create({ name: "  editor ", translations: [{ lang: "ar", title: "x" }] }, "actor-1", null);

      expect(prisma.roles.findFirst.mock.calls[0][0].where.name.equals).toBe("editor");
      expect(mockTx.roles.create).toHaveBeenCalledWith({ data: { name: "editor" } });
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

    describe("rename", () => {
      beforeEach(() => {
        prisma.roles.findUnique
          .mockResolvedValueOnce({ id: "role-1", name: "Admin" }) // initial lookup
          .mockResolvedValue(baseRoleWithRelations); // hydrate after update
        prisma.roles.findFirst.mockResolvedValue(null);
        mockTx.roles.update.mockResolvedValue({});
        prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      });

      it("checks the new name case-insensitively and excludes the role being renamed", async () => {
        await service.update("role-1", { name: "ADMIN" }, "actor-1", null);

        expect(prisma.roles.findFirst).toHaveBeenCalledWith({
          where: { name: { equals: "ADMIN", mode: "insensitive" }, NOT: { id: "role-1" } },
          select: { id: true },
        });
        // A case-only rename of the role itself is allowed.
        expect(mockTx.roles.update).toHaveBeenCalledWith({ where: { id: "role-1" }, data: { name: "ADMIN" } });
      });

      it("rejects a rename that only differs from another role in letter case", async () => {
        prisma.roles.findFirst.mockResolvedValue({ id: "role-2", name: "Editor" });

        await expect(service.update("role-1", { name: "editor" }, "actor-1", null)).rejects.toThrow(ConflictException);
        expect(mockTx.roles.update).not.toHaveBeenCalled();
      });

      it("trims the new name", async () => {
        await service.update("role-1", { name: "  reviewer " }, "actor-1", null);

        expect(prisma.roles.findFirst.mock.calls[0][0].where.name.equals).toBe("reviewer");
        expect(mockTx.roles.update).toHaveBeenCalledWith({ where: { id: "role-1" }, data: { name: "reviewer" } });
      });

      it("audits a rename with the before and after names", async () => {
        await service.update("role-1", { name: "Reviewer" }, "actor-1", null);

        expect(audit.write).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: "actor-1",
            action: "ROLE_UPDATED",
            resourceId: "role-1",
            changes: expect.objectContaining({ name: { before: "Admin", after: "Reviewer" } }),
          }),
        );
      });

      it("does not run the name check or record a rename when the name is unchanged", async () => {
        await service.update("role-1", { name: " Admin ", translations: [{ lang: "ar", title: "مدير" }] }, "actor-1", null);

        expect(prisma.roles.findFirst).not.toHaveBeenCalled();
        expect(audit.write.mock.calls[0][0].changes).not.toHaveProperty("name");
      });
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

    describe("race safety of the unassigned check", () => {
      beforeEach(() => {
        mockTx.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
        mockTx.user_roles.count.mockResolvedValue(0);
        prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
      });

      it("locks the role row FOR UPDATE inside the transaction, BEFORE counting assignments", async () => {
        await service.delete("role-1", "actor-1");

        expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
        const [strings, ...values] = mockTx.$queryRaw.mock.calls[0];
        const sql = (strings as string[]).join("?").replace(/\s+/g, " ").trim();
        expect(sql).toBe("SELECT id FROM roles WHERE id = ?::uuid FOR UPDATE");
        expect(values).toEqual(["role-1"]);
        expect(mockTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          mockTx.user_roles.count.mock.invocationCallOrder[0],
        );
        expect(mockTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          mockTx.roles.delete.mock.invocationCallOrder[0],
        );
      });

      it("treats a role that vanished between the read and the lock as not found", async () => {
        mockTx.$queryRaw.mockResolvedValue([]);

        await expect(service.delete("role-1", "actor-1")).rejects.toThrow(NotFoundException);
        expect(mockTx.user_roles.count).not.toHaveBeenCalled();
        expect(mockTx.roles.delete).not.toHaveBeenCalled();
      });

      it("refuses, and deletes nothing, when an assignment that was in flight is now visible", async () => {
        mockTx.user_roles.count.mockResolvedValue(1);

        await expect(service.delete("role-1", "actor-1")).rejects.toThrow(ConflictException);
        expect(mockTx.role_permissions.deleteMany).not.toHaveBeenCalled();
        expect(mockTx.roles.delete).not.toHaveBeenCalled();
      });
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
        actor,
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
          actor,
          null,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when permission not found", async () => {
      prisma.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      prisma.permissions.findUnique.mockResolvedValue(null);

      await expect(
        service.assignPermission("role-1", { permissionId: "ghost" }, actor, null),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.role_permissions.upsert).not.toHaveBeenCalled();
    });

    it("forbids granting a permission the actor does not hold", async () => {
      // Self-escalation path: a custom role holding roles:update attaches users:delete to itself.
      prisma.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      prisma.permissions.findUnique.mockResolvedValue({ id: "perm-9", name: "users:delete" });

      await expect(
        service.assignPermission("role-1", { permissionId: "perm-9" }, actor, null),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.role_permissions.upsert).not.toHaveBeenCalled();
    });
  });

  describe("removePermission", () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    });

    it("deletes role_permissions record and returns hydrated role", async () => {
      prisma.roles.findUnique
        .mockResolvedValueOnce({ id: "role-1", name: "Admin" }) // initial lookup
        .mockResolvedValueOnce(baseRoleWithRelations); // hydrate after remove
      mockTx.role_permissions.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.removePermission(
        "role-1",
        "perm-1",
        actor,
        null,
      );

      expect(mockTx.role_permissions.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role_id: "role-1", permission_id: "perm-1" } }),
      );
      expect(result.message).toBe("Permission removed");
      expect(result.data.permissions).toBeDefined();
    });

    it("throws NotFoundException when role not found", async () => {
      prisma.roles.findUnique.mockResolvedValue(null);

      await expect(
        service.removePermission("ghost", "perm-1", actor, null),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when permission is not assigned", async () => {
      prisma.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      mockTx.role_permissions.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.removePermission("role-1", "perm-1", actor, null),
      ).rejects.toThrow(NotFoundException);
    });

    it("forbids revoking a permission the actor does not hold", async () => {
      prisma.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      prisma.permissions.findUnique.mockResolvedValue({ id: "perm-9", name: "users:delete" });

      await expect(
        service.removePermission("role-1", "perm-9", actor, null),
      ).rejects.toThrow(ForbiddenException);
      expect(mockTx.role_permissions.deleteMany).not.toHaveBeenCalled();
    });

    it("refuses to revoke the permission that makes the last administrator whole", async () => {
      prisma.roles.findUnique.mockResolvedValue({ id: "role-1", name: "Admin" });
      // One permission exists; the only active user holds it via role-1.
      mockTx.permissions.count.mockResolvedValue(1);
      mockTx.users.findMany.mockResolvedValue([
        { id: "user-1", user_roles: [{ role_id: "role-1", roles: { role_permissions: [{ permission_id: "perm-1" }] } }] },
      ]);

      await expect(
        service.removePermission("role-1", "perm-1", actor, null),
      ).rejects.toThrow(ConflictException);
      expect(mockTx.role_permissions.deleteMany).not.toHaveBeenCalled();
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
