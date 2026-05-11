import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── Languages ─────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'ar', name: 'Arabic', native_name: 'العربية' },
  { code: 'en', name: 'English', native_name: 'English' },
  { code: 'fa', name: 'Persian', native_name: 'فارسی' },
];

// ── Permissions ───────────────────────────────────────────────────────────────

type Translations = {
  ar: { title: string; description?: string };
  en: { title: string; description?: string };
  fa: { title: string; description?: string };
};

const PERMISSIONS: { name: string; translations: Translations }[] = [
  // Posts
  {
    name: 'posts:read',
    translations: {
      ar: { title: 'قراءة المقالات', description: 'عرض قائمة المقالات وتفاصيلها' },
      en: { title: 'Read Posts', description: 'View published and draft posts' },
      fa: { title: 'مشاهده مطالب', description: 'مشاهده لیست و جزئیات مطالب' },
    },
  },
  {
    name: 'posts:create',
    translations: {
      ar: { title: 'إنشاء مقالة', description: 'إضافة مقالات جديدة' },
      en: { title: 'Create Posts', description: 'Add new posts' },
      fa: { title: 'ایجاد مطلب', description: 'افزودن مطالب جدید' },
    },
  },
  {
    name: 'posts:update',
    translations: {
      ar: { title: 'تعديل المقالات', description: 'تحرير وتحديث ونشر المقالات' },
      en: { title: 'Update Posts', description: 'Edit, update, and publish posts' },
      fa: { title: 'ویرایش مطالب', description: 'ویرایش، بروزرسانی و انتشار مطالب' },
    },
  },
  {
    name: 'posts:delete',
    translations: {
      ar: { title: 'حذف المقالات', description: 'حذف المقالات من النظام' },
      en: { title: 'Delete Posts', description: 'Remove posts from the system' },
      fa: { title: 'حذف مطالب', description: 'حذف مطالب از سیستم' },
    },
  },

  // Post categories
  {
    name: 'post-categories:create',
    translations: {
      ar: { title: 'إنشاء تصنيفات المقالات', description: 'إضافة تصنيفات جديدة للمقالات' },
      en: { title: 'Create Post Categories', description: 'Add new post categories' },
      fa: { title: 'ایجاد دسته‌بندی مطالب', description: 'افزودن دسته‌بندی جدید برای مطالب' },
    },
  },
  {
    name: 'post-categories:update',
    translations: {
      ar: { title: 'تعديل تصنيفات المقالات', description: 'تحرير تصنيفات المقالات الموجودة' },
      en: { title: 'Update Post Categories', description: 'Edit existing post categories' },
      fa: { title: 'ویرایش دسته‌بندی مطالب', description: 'ویرایش دسته‌بندی‌های موجود مطالب' },
    },
  },
  {
    name: 'post-categories:delete',
    translations: {
      ar: { title: 'حذف تصنيفات المقالات', description: 'حذف تصنيفات المقالات' },
      en: { title: 'Delete Post Categories', description: 'Remove post categories' },
      fa: { title: 'حذف دسته‌بندی مطالب', description: 'حذف دسته‌بندی‌های مطالب' },
    },
  },

  // Books
  {
    name: 'books:create',
    translations: {
      ar: { title: 'إضافة كتاب', description: 'رفع وإضافة كتب جديدة إلى المكتبة' },
      en: { title: 'Create Books', description: 'Add new books to the library' },
      fa: { title: 'افزودن کتاب', description: 'اضافه کردن کتاب‌های جدید به کتابخانه' },
    },
  },
  {
    name: 'books:update',
    translations: {
      ar: { title: 'تعديل الكتب', description: 'تحرير بيانات الكتب الموجودة' },
      en: { title: 'Update Books', description: 'Edit existing book records' },
      fa: { title: 'ویرایش کتاب‌ها', description: 'ویرایش اطلاعات کتاب‌های موجود' },
    },
  },
  {
    name: 'books:delete',
    translations: {
      ar: { title: 'حذف الكتب', description: 'حذف الكتب من المكتبة' },
      en: { title: 'Delete Books', description: 'Remove books from the library' },
      fa: { title: 'حذف کتاب‌ها', description: 'حذف کتاب‌ها از کتابخانه' },
    },
  },

  // Book categories
  {
    name: 'book-categories:create',
    translations: {
      ar: { title: 'إنشاء تصنيفات الكتب', description: 'إضافة تصنيفات جديدة للمكتبة' },
      en: { title: 'Create Book Categories', description: 'Add new book categories' },
      fa: { title: 'ایجاد دسته‌بندی کتاب‌ها', description: 'افزودن دسته‌بندی جدید برای کتاب‌ها' },
    },
  },
  {
    name: 'book-categories:update',
    translations: {
      ar: { title: 'تعديل تصنيفات الكتب', description: 'تحرير تصنيفات الكتب الموجودة' },
      en: { title: 'Update Book Categories', description: 'Edit existing book categories' },
      fa: { title: 'ویرایش دسته‌بندی کتاب‌ها', description: 'ویرایش دسته‌بندی‌های موجود کتاب‌ها' },
    },
  },
  {
    name: 'book-categories:delete',
    translations: {
      ar: { title: 'حذف تصنيفات الكتب', description: 'حذف تصنيفات الكتب' },
      en: { title: 'Delete Book Categories', description: 'Remove book categories' },
      fa: { title: 'حذف دسته‌بندی کتاب‌ها', description: 'حذف دسته‌بندی‌های کتاب‌ها' },
    },
  },

  // Academic papers
  {
    name: 'academic-papers:create',
    translations: {
      ar: { title: 'رفع بحث علمي', description: 'إضافة بحوث ودراسات علمية جديدة' },
      en: { title: 'Create Academic Papers', description: 'Upload new academic papers and studies' },
      fa: { title: 'افزودن مقاله علمی', description: 'بارگذاری مقالات و پژوهش‌های علمی جدید' },
    },
  },
  {
    name: 'academic-papers:update',
    translations: {
      ar: { title: 'تعديل البحوث العلمية', description: 'تحرير بيانات البحوث الموجودة' },
      en: { title: 'Update Academic Papers', description: 'Edit existing academic paper records' },
      fa: { title: 'ویرایش مقالات علمی', description: 'ویرایش اطلاعات مقالات موجود' },
    },
  },
  {
    name: 'academic-papers:delete',
    translations: {
      ar: { title: 'حذف البحوث العلمية', description: 'حذف البحوث من الأرشيف' },
      en: { title: 'Delete Academic Papers', description: 'Remove papers from the archive' },
      fa: { title: 'حذف مقالات علمی', description: 'حذف مقالات از آرشیو' },
    },
  },

  // Academic paper categories
  {
    name: 'academic-paper-categories:create',
    translations: {
      ar: { title: 'إنشاء تصنيفات البحوث', description: 'إضافة تصنيفات جديدة للبحوث العلمية' },
      en: { title: 'Create Academic Paper Categories', description: 'Add new categories for academic papers' },
      fa: { title: 'ایجاد دسته‌بندی مقالات علمی', description: 'افزودن دسته‌بندی جدید برای مقالات علمی' },
    },
  },
  {
    name: 'academic-paper-categories:update',
    translations: {
      ar: { title: 'تعديل تصنيفات البحوث', description: 'تحرير تصنيفات البحوث الموجودة' },
      en: { title: 'Update Academic Paper Categories', description: 'Edit existing paper categories' },
      fa: { title: 'ویرایش دسته‌بندی مقالات علمی', description: 'ویرایش دسته‌بندی‌های موجود مقالات' },
    },
  },
  {
    name: 'academic-paper-categories:delete',
    translations: {
      ar: { title: 'حذف تصنيفات البحوث', description: 'حذف تصنيفات البحوث العلمية' },
      en: { title: 'Delete Academic Paper Categories', description: 'Remove academic paper categories' },
      fa: { title: 'حذف دسته‌بندی مقالات علمی', description: 'حذف دسته‌بندی‌های مقالات علمی' },
    },
  },

  // Gallery
  {
    name: 'gallery:create',
    translations: {
      ar: { title: 'إضافة صور المعرض', description: 'رفع وإضافة صور إلى معرض الصور' },
      en: { title: 'Create Gallery Images', description: 'Upload images to the gallery' },
      fa: { title: 'افزودن تصویر به گالری', description: 'بارگذاری تصاویر به گالری' },
    },
  },
  {
    name: 'gallery:update',
    translations: {
      ar: { title: 'تعديل صور المعرض', description: 'تحرير بيانات صور المعرض' },
      en: { title: 'Update Gallery Images', description: 'Edit gallery image metadata' },
      fa: { title: 'ویرایش تصاویر گالری', description: 'ویرایش اطلاعات تصاویر گالری' },
    },
  },
  {
    name: 'gallery:delete',
    translations: {
      ar: { title: 'حذف صور المعرض', description: 'حذف الصور من معرض الصور' },
      en: { title: 'Delete Gallery Images', description: 'Remove images from the gallery' },
      fa: { title: 'حذف تصاویر گالری', description: 'حذف تصاویر از گالری' },
    },
  },

  // Gallery categories
  {
    name: 'gallery-categories:create',
    translations: {
      ar: { title: 'إنشاء تصنيفات المعرض', description: 'إضافة تصنيفات جديدة لمعرض الصور' },
      en: { title: 'Create Gallery Categories', description: 'Add new gallery categories' },
      fa: { title: 'ایجاد دسته‌بندی گالری', description: 'افزودن دسته‌بندی جدید برای گالری' },
    },
  },
  {
    name: 'gallery-categories:update',
    translations: {
      ar: { title: 'تعديل تصنيفات المعرض', description: 'تحرير تصنيفات معرض الصور الموجودة' },
      en: { title: 'Update Gallery Categories', description: 'Edit existing gallery categories' },
      fa: { title: 'ویرایش دسته‌بندی گالری', description: 'ویرایش دسته‌بندی‌های موجود گالری' },
    },
  },
  {
    name: 'gallery-categories:delete',
    translations: {
      ar: { title: 'حذف تصنيفات المعرض', description: 'حذف تصنيفات معرض الصور' },
      en: { title: 'Delete Gallery Categories', description: 'Remove gallery categories' },
      fa: { title: 'حذف دسته‌بندی گالری', description: 'حذف دسته‌بندی‌های گالری' },
    },
  },

  // Media
  {
    name: 'media:create',
    translations: {
      ar: { title: 'رفع الوسائط', description: 'رفع ملفات الصور والمستندات إلى مكتبة الوسائط' },
      en: { title: 'Upload Media', description: 'Upload images and documents to the media library' },
      fa: { title: 'آپلود رسانه', description: 'بارگذاری تصاویر و اسناد به کتابخانه رسانه' },
    },
  },
  {
    name: 'media:read',
    translations: {
      ar: { title: 'عرض مكتبة الوسائط', description: 'تصفح وعرض الملفات في مكتبة الوسائط' },
      en: { title: 'View Media Library', description: 'Browse and view files in the media library' },
      fa: { title: 'مشاهده کتابخانه رسانه', description: 'مرور و مشاهده فایل‌های کتابخانه رسانه' },
    },
  },
  {
    name: 'media:update',
    translations: {
      ar: { title: 'تعديل الوسائط', description: 'تحرير بيانات ملفات الوسائط' },
      en: { title: 'Update Media', description: 'Edit media file metadata' },
      fa: { title: 'ویرایش رسانه', description: 'ویرایش اطلاعات فایل‌های رسانه' },
    },
  },
  {
    name: 'media:delete',
    translations: {
      ar: { title: 'حذف الوسائط', description: 'حذف الملفات من مكتبة الوسائط' },
      en: { title: 'Delete Media', description: 'Remove files from the media library' },
      fa: { title: 'حذف رسانه', description: 'حذف فایل‌ها از کتابخانه رسانه' },
    },
  },

  // Forms
  {
    name: 'forms:read',
    translations: {
      ar: { title: 'عرض النماذج الواردة', description: 'مراجعة طلبات الزيارة وبلاغات التواصل' },
      en: { title: 'Read Form Submissions', description: 'View contact messages and proxy visit requests' },
      fa: { title: 'مشاهده فرم‌های دریافتی', description: 'مشاهده پیام‌های تماس و درخواست‌های زیارت' },
    },
  },
  {
    name: 'forms:update',
    translations: {
      ar: { title: 'تحديث النماذج الواردة', description: 'تغيير حالة طلبات الزيارة والرسائل والرد عليها' },
      en: { title: 'Update Form Submissions', description: 'Change status of contact messages and visit requests' },
      fa: { title: 'بروزرسانی فرم‌های دریافتی', description: 'تغییر وضعیت پیام‌ها و درخواست‌های زیارت' },
    },
  },
  {
    name: 'forms:delete',
    translations: {
      ar: { title: 'حذف النماذج الواردة', description: 'حذف طلبات الزيارة والرسائل المكتملة' },
      en: { title: 'Delete Form Submissions', description: 'Remove completed contact messages and visit requests' },
      fa: { title: 'حذف فرم‌های دریافتی', description: 'حذف پیام‌ها و درخواست‌های زیارت تکمیل شده' },
    },
  },

  // Newsletter
  {
    name: 'newsletter:read',
    translations: {
      ar: { title: 'عرض مشتركي النشرة', description: 'مراجعة قائمة المشتركين في النشرة الإخبارية' },
      en: { title: 'View Newsletter Subscribers', description: 'View the list of newsletter subscribers' },
      fa: { title: 'مشاهده مشترکین خبرنامه', description: 'مشاهده فهرست مشترکین خبرنامه' },
    },
  },
  {
    name: 'newsletter:update',
    translations: {
      ar: { title: 'تعديل المشتركين', description: 'تفعيل أو إلغاء اشتراك المشتركين عبر لوحة الإدارة' },
      en: { title: 'Update Newsletter Subscribers', description: 'Admin-side activate / deactivate of subscribers' },
      fa: { title: 'به‌روزرسانی مشترکین خبرنامه', description: 'فعال‌سازی یا غیرفعال کردن مشترکین از طرف مدیر' },
    },
  },
  {
    name: 'newsletter:delete',
    translations: {
      ar: { title: 'إزالة المشتركين', description: 'إلغاء اشتراك أو حذف مشتركي النشرة' },
      en: { title: 'Remove Newsletter Subscribers', description: 'Unsubscribe or remove newsletter subscribers' },
      fa: { title: 'حذف مشترکین خبرنامه', description: 'لغو اشتراک یا حذف مشترکین خبرنامه' },
    },
  },

  // Dashboard
  {
    name: 'dashboard:read',
    translations: {
      ar: { title: 'عرض لوحة التحكم', description: 'الوصول إلى الإحصائيات الرئيسية للنظام' },
      en: { title: 'View Dashboard', description: 'Access aggregated CMS dashboard counts' },
      fa: { title: 'مشاهده داشبورد', description: 'دسترسی به آمار کلی سامانه' },
    },
  },

  // Audit logs
  {
    name: 'audit-logs:read',
    translations: {
      ar: { title: 'عرض سجل التدقيق', description: 'مراجعة جميع العمليات المسجلة في النظام' },
      en: { title: 'View Audit Logs', description: 'Browse the full audit trail of write operations' },
      fa: { title: 'مشاهده گزارش حسابرسی', description: 'مرور سابقه عملیات ثبت‌شده در سامانه' },
    },
  },

  // Contest
  {
    name: 'contest:read',
    translations: {
      ar: { title: 'عرض محاولات المسابقة', description: 'مراجعة قائمة محاولات مسابقة قطوف السجادية ونتائجها' },
      en: { title: 'View Contest Attempts', description: 'Review Qutuf Sajjadiyya contest attempts and scores' },
      fa: { title: 'مشاهده تلاش‌های مسابقه', description: 'مرور لیست تلاش‌های مسابقه قطوف سجادیه و امتیازات' },
    },
  },

  // Site settings
  {
    name: 'settings:read',
    translations: {
      ar: { title: 'عرض الإعدادات', description: 'مراجعة إعدادات الموقع العامة والخاصة' },
      en: { title: 'View Site Settings', description: 'Read public and admin site settings' },
      fa: { title: 'مشاهده تنظیمات سایت', description: 'مرور تنظیمات عمومی و مدیریتی سایت' },
    },
  },
  {
    name: 'settings:update',
    translations: {
      ar: { title: 'تعديل الإعدادات', description: 'إضافة وتحديث إعدادات الموقع' },
      en: { title: 'Update Site Settings', description: 'Create and update site-wide settings' },
      fa: { title: 'به‌روزرسانی تنظیمات سایت', description: 'افزودن و به‌روزرسانی تنظیمات سایت' },
    },
  },
  {
    name: 'settings:delete',
    translations: {
      ar: { title: 'حذف الإعدادات', description: 'إزالة مفاتيح الإعدادات' },
      en: { title: 'Delete Site Settings', description: 'Remove site setting keys' },
      fa: { title: 'حذف تنظیمات سایت', description: 'حذف کلیدهای تنظیمات سایت' },
    },
  },

  // Languages
  {
    name: 'languages:read',
    translations: {
      ar: { title: 'عرض اللغات', description: 'مراجعة اللغات المدعومة في النظام' },
      en: { title: 'View Languages', description: 'View supported languages in the system' },
      fa: { title: 'مشاهده زبان‌ها', description: 'مشاهده زبان‌های پشتیبانی‌شده در سیستم' },
    },
  },
  {
    name: 'languages:create',
    translations: {
      ar: { title: 'إضافة لغة', description: 'إضافة لغة جديدة مدعومة للنظام' },
      en: { title: 'Add Languages', description: 'Add a new supported language to the system' },
      fa: { title: 'افزودن زبان', description: 'افزودن زبان جدید به سیستم' },
    },
  },
  {
    name: 'languages:update',
    translations: {
      ar: { title: 'تعديل اللغات', description: 'تحرير بيانات اللغات الموجودة' },
      en: { title: 'Update Languages', description: 'Edit existing language records' },
      fa: { title: 'ویرایش زبان‌ها', description: 'ویرایش اطلاعات زبان‌های موجود' },
    },
  },
  {
    name: 'languages:delete',
    translations: {
      ar: { title: 'حذف اللغات', description: 'إزالة لغة من النظام' },
      en: { title: 'Delete Languages', description: 'Remove a language from the system' },
      fa: { title: 'حذف زبان‌ها', description: 'حذف یک زبان از سیستم' },
    },
  },

  // Users
  {
    name: 'users:read',
    translations: {
      ar: { title: 'عرض المستخدمين', description: 'مراجعة قائمة مستخدمي لوحة التحكم وبياناتهم' },
      en: { title: 'View Users', description: 'View CMS user list and their details' },
      fa: { title: 'مشاهده کاربران', description: 'مشاهده فهرست کاربران سیستم مدیریت' },
    },
  },
  {
    name: 'users:create',
    translations: {
      ar: { title: 'إنشاء مستخدم', description: 'إضافة حسابات مستخدمين جديدة للوحة التحكم' },
      en: { title: 'Create Users', description: 'Add new CMS user accounts' },
      fa: { title: 'ایجاد کاربر', description: 'افزودن حساب‌های کاربری جدید به سیستم' },
    },
  },
  {
    name: 'users:update',
    translations: {
      ar: { title: 'تعديل المستخدمين', description: 'تحرير بيانات المستخدمين وتعيين أدوارهم' },
      en: { title: 'Update Users', description: 'Edit user details and assign roles' },
      fa: { title: 'ویرایش کاربران', description: 'ویرایش اطلاعات کاربران و تخصیص نقش' },
    },
  },
  {
    name: 'users:delete',
    translations: {
      ar: { title: 'حذف المستخدمين', description: 'حذف حسابات المستخدمين من النظام' },
      en: { title: 'Delete Users', description: 'Remove user accounts from the system' },
      fa: { title: 'حذف کاربران', description: 'حذف حساب‌های کاربری از سیستم' },
    },
  },

  // Roles
  {
    name: 'roles:read',
    translations: {
      ar: { title: 'عرض الأدوار', description: 'مراجعة الأدوار وصلاحياتها' },
      en: { title: 'View Roles', description: 'View roles and their permission assignments' },
      fa: { title: 'مشاهده نقش‌ها', description: 'مشاهده نقش‌ها و دسترسی‌های آن‌ها' },
    },
  },
  {
    name: 'roles:create',
    translations: {
      ar: { title: 'إنشاء دور', description: 'إضافة أدوار جديدة وتعيين صلاحياتها' },
      en: { title: 'Create Roles', description: 'Add new roles and assign permissions to them' },
      fa: { title: 'ایجاد نقش', description: 'افزودن نقش‌های جدید و تخصیص دسترسی' },
    },
  },
  {
    name: 'roles:update',
    translations: {
      ar: { title: 'تعديل الأدوار', description: 'تحرير بيانات الأدوار وصلاحياتها' },
      en: { title: 'Update Roles', description: 'Edit role details and permission assignments' },
      fa: { title: 'ویرایش نقش‌ها', description: 'ویرایش اطلاعات نقش‌ها و دسترسی‌های آن‌ها' },
    },
  },
  {
    name: 'roles:delete',
    translations: {
      ar: { title: 'حذف الأدوار', description: 'حذف الأدوار من النظام' },
      en: { title: 'Delete Roles', description: 'Remove roles from the system' },
      fa: { title: 'حذف نقش‌ها', description: 'حذف نقش‌ها از سیستم' },
    },
  },
];

const ALL_PERMISSION_NAMES = PERMISSIONS.map((p) => p.name);

// ── Role definitions ──────────────────────────────────────────────────────────

type RoleTranslations = {
  ar: { title: string; description?: string };
  en: { title: string; description?: string };
  fa: { title: string; description?: string };
};

const ROLES: { name: string; permissions: string[]; translations: RoleTranslations }[] = [
  {
    name: 'super-admin',
    // Full system access — reserved for the technical owner/IT administrator
    permissions: ALL_PERMISSION_NAMES,
    translations: {
      ar: {
        title: 'مدير النظام العام',
        description: 'صلاحيات كاملة على جميع أجزاء النظام بما فيها الأدوار والمستخدمين والإعدادات',
      },
      en: {
        title: 'Super Administrator',
        description: 'Full system access including roles, users, and system-level configuration',
      },
      fa: {
        title: 'مدیر کل سیستم',
        description: 'دسترسی کامل به تمام بخش‌های سیستم شامل نقش‌ها، کاربران و تنظیمات',
      },
    },
  },
  {
    name: 'admin',
    // All content + users + forms + newsletter + media; can view but not modify roles/languages
    permissions: ALL_PERMISSION_NAMES.filter(
      (p) =>
        !['roles:create', 'roles:update', 'roles:delete', 'languages:create', 'languages:update', 'languages:delete'].includes(p),
    ),
    translations: {
      ar: {
        title: 'مدير',
        description: 'إدارة المحتوى والمستخدمين والنماذج الواردة؛ لا يمكنه تعديل الأدوار أو اللغات',
      },
      en: {
        title: 'Administrator',
        description: 'Manage all content, users, and inbound forms; cannot modify roles or system languages',
      },
      fa: {
        title: 'مدیر',
        description: 'مدیریت محتوا، کاربران و فرم‌های دریافتی؛ امکان تغییر نقش‌ها و زبان‌ها وجود ندارد',
      },
    },
  },
  {
    name: 'editor',
    // All content types and media; no access to forms, users, roles, or languages
    permissions: [
      'posts:read',
      'posts:create',
      'posts:update',
      'posts:delete',
      'post-categories:create',
      'post-categories:update',
      'post-categories:delete',
      'books:create',
      'books:update',
      'books:delete',
      'book-categories:create',
      'book-categories:update',
      'book-categories:delete',
      'academic-papers:create',
      'academic-papers:update',
      'academic-papers:delete',
      'academic-paper-categories:create',
      'academic-paper-categories:update',
      'academic-paper-categories:delete',
      'gallery:create',
      'gallery:update',
      'gallery:delete',
      'gallery-categories:create',
      'gallery-categories:update',
      'gallery-categories:delete',
      'media:create',
      'media:read',
      'media:update',
      'media:delete',
      'dashboard:read',
    ],
    translations: {
      ar: {
        title: 'محرر المحتوى',
        description: 'إنشاء وتعديل جميع أنواع المحتوى والوسائط؛ لا صلاحية له على المستخدمين أو النماذج',
      },
      en: {
        title: 'Content Editor',
        description: 'Create and manage all content types and media; no access to users, forms, or system settings',
      },
      fa: {
        title: 'ویراستار محتوا',
        description: 'ایجاد و مدیریت انواع محتوا و رسانه؛ بدون دسترسی به کاربران، فرم‌ها یا تنظیمات سیستم',
      },
    },
  },
  {
    name: 'moderator',
    // Handles inbound contact messages, proxy visit requests, newsletter,
    // and reads contest attempts; read-only on posts for context.
    permissions: [
      'forms:read',
      'forms:update',
      'forms:delete',
      'newsletter:read',
      'newsletter:update',
      'newsletter:delete',
      'posts:read',
      'contest:read',
      'dashboard:read',
    ],
    translations: {
      ar: {
        title: 'مشرف',
        description: 'مراجعة النماذج الواردة وطلبات الزيارة والنشرة الإخبارية والرد عليها',
      },
      en: {
        title: 'Moderator',
        description: 'Review and respond to contact submissions, proxy visit requests, and newsletter',
      },
      fa: {
        title: 'ناظر',
        description: 'بررسی و پاسخ به فرم‌های تماس، درخواست‌های زیارت و خبرنامه',
      },
    },
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database…\n');

  // 1. Languages
  console.log('→ Languages');
  for (const lang of LANGUAGES) {
    await prisma.languages.upsert({
      where: { code: lang.code },
      create: lang,
      update: { name: lang.name, native_name: lang.native_name },
    });
  }
  console.log(`  ✓ ${LANGUAGES.length} languages`);

  // 2. Permissions + translations
  console.log('→ Permissions');
  const permMap: Record<string, string> = {};
  for (const perm of PERMISSIONS) {
    const p = await prisma.permissions.upsert({
      where: { name: perm.name },
      create: { name: perm.name },
      update: {},
    });
    permMap[perm.name] = p.id;

    for (const [lang, t] of Object.entries(perm.translations) as [string, { title: string; description?: string }][]) {
      await prisma.permission_translations.upsert({
        where: { permission_id_lang: { permission_id: p.id, lang } },
        create: { permission_id: p.id, lang, title: t.title, description: t.description },
        update: { title: t.title, description: t.description },
      });
    }
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions (${PERMISSIONS.length * 3} translations)`);

  // 3. Roles + translations + role_permissions
  console.log('→ Roles');
  for (const role of ROLES) {
    const r = await prisma.roles.upsert({
      where: { name: role.name },
      create: { name: role.name },
      update: {},
    });

    for (const [lang, t] of Object.entries(role.translations) as [string, { title: string; description?: string }][]) {
      await prisma.role_translations.upsert({
        where: { role_id_lang: { role_id: r.id, lang } },
        create: { role_id: r.id, lang, title: t.title, description: t.description },
        update: { title: t.title, description: t.description },
      });
    }

    for (const permName of role.permissions) {
      const permId = permMap[permName];
      await prisma.role_permissions.upsert({
        where: { role_id_permission_id: { role_id: r.id, permission_id: permId } },
        create: { role_id: r.id, permission_id: permId },
        update: {},
      });
    }

    console.log(`  ✓ ${role.name} (${role.permissions.length} permissions)`);
  }

  // 4. Bootstrap super-admin user
  console.log('→ Bootstrap user');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'superadmin';

  if (!adminPassword) {
    console.warn(
      '\n  ⚠  SEED_ADMIN_PASSWORD is not set.\n' +
        '     Set it in your environment before running the seed in production.\n' +
        '     Skipping bootstrap user creation.\n',
    );
  } else {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);
    const hash = await bcrypt.hash(adminPassword, rounds);

    const superAdminRole = await prisma.roles.findFirst({ where: { name: 'super-admin' } });
    if (!superAdminRole) throw new Error('super-admin role not found after upsert');

    const existing = await prisma.users.findFirst({ where: { username: adminUsername, deleted_at: null } });
    if (existing) {
      console.log(`  ℹ  User "${adminUsername}" already exists — skipping creation`);
    } else {
      const user = await prisma.users.create({
        data: {
          username: adminUsername,
          password_hash: hash,
          user_roles: { create: { role_id: superAdminRole.id } },
        },
      });
      console.log(`  ✓ Created user "${user.username}" with role super-admin`);
    }
  }

  // 5. Seed initial site settings (idempotent — only sets values that don't yet exist)
  console.log('→ Site settings');
  const INITIAL_SETTINGS: Array<{
    key: string;
    value: string;
    type?: 'string' | 'number' | 'boolean' | 'json';
    description: string;
    is_public: boolean;
  }> = [
    { key: 'site_name', value: 'Imam Zain Foundation', description: 'Title shown in <title> / og:site_name / footer.', is_public: true },
    { key: 'site_tagline', value: 'الإمام علي بن الحسين زين العابدين', description: 'Tagline beneath the site name.', is_public: true },
    { key: 'default_language', value: 'ar', description: 'Fallback language for translations when none is requested.', is_public: true },
    { key: 'contact_email', value: 'info@imamzain.org', description: 'Public-facing contact email.', is_public: true },
    { key: 'notifications_email_to', value: 'info@imamzain.org', description: 'Address that receives form / proxy-visit notifications. Overrides the EMAIL_TO env var when set.', is_public: false },
    { key: 'social_facebook', value: '', description: 'Facebook page URL (empty to hide).', is_public: true },
    { key: 'social_twitter', value: '', description: 'X / Twitter URL (empty to hide).', is_public: true },
    { key: 'social_instagram', value: '', description: 'Instagram URL (empty to hide).', is_public: true },
    { key: 'social_youtube', value: '', description: 'YouTube channel URL (empty to hide).', is_public: true },
  ];

  let createdSettings = 0;
  for (const s of INITIAL_SETTINGS) {
    const result = await prisma.site_settings.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value, type: s.type ?? 'string', description: s.description, is_public: s.is_public },
      update: {}, // never overwrite an existing setting — operators have likely tuned them
    });
    if (result) createdSettings++;
  }
  console.log(`  ✓ ${INITIAL_SETTINGS.length} setting keys present (existing values preserved)`);

  console.log('\nSeed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());