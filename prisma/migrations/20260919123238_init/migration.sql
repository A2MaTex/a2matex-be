CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "UserStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'BANNED'
);

CREATE TYPE "RoleStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE'
);

CREATE TYPE "VerificationCodeType" AS ENUM (
    'REGISTER',
    'FORGOT_PASSWORD',
    'LOGIN',
    'DISABLE_2FA'
);

CREATE TYPE "HTTPMethod" AS ENUM (
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'OPTIONS',
    'HEAD'
);

CREATE TABLE "User" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) NOT NULL,
    email TEXT NOT NULL,
    password VARCHAR(255) NOT NULL,
    status "UserStatus" NOT NULL DEFAULT 'INACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX "User_username_idx" ON "User" (lower(username)) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "User_email_idx" ON "User" (lower(email)) WHERE "deletedAt" IS NULL;

CREATE TABLE "Profile" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "User" (id),
    "fullName" VARCHAR(255) NOT NULL,
    "avatarStaticId" UUID,
    bio TEXT,
    website TEXT,
    twitter TEXT,
    linkedin TEXT,
    github TEXT,
    instagram TEXT,
    gender VARCHAR(20),
    birthday DATE,
    address TEXT,
    phone TEXT,
    email TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,
    "createdById" UUID REFERENCES "User" (id) NOT NULL,
    "updatedById" UUID REFERENCES "User" (id),
    "deletedById" UUID REFERENCES "User" (id)
);

CREATE UNIQUE INDEX "Profile_userId_idx" ON "Profile" ("userId") WHERE "deletedAt" IS NULL;

CREATE TABLE "VerificationCode" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(500) NOT NULL,
    code VARCHAR(50) NOT NULL,
    type "VerificationCodeType" NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX "VerificationCode_email_type_idx" ON "VerificationCode" (email, type) WHERE "deletedAt" IS NULL;

CREATE TABLE "Device" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID REFERENCES "User" (id),
    "userAgent" TEXT NOT NULL,
    ip TEXT NOT NULL,
    "lastActive" TIMESTAMPTZ NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX "Device_userId_idx" ON "Device" ("userId") WHERE "deletedAt" IS NULL;

CREATE TABLE "RefreshToken" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL,
    "userId" UUID REFERENCES "User" (id),
    "deviceId" UUID REFERENCES "Device" (id),
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX "RefreshToken_token_idx" ON "RefreshToken" (token) WHERE "deletedAt" IS NULL;

CREATE TABLE "Permission" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(500) NOT NULL,
    module VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    path VARCHAR(1000) NOT NULL,
    method "HTTPMethod" NOT NULL,
    "createdById" UUID REFERENCES "User" (id) NOT NULL,
    "updatedById" UUID REFERENCES "User" (id),
    "deletedById" UUID REFERENCES "User" (id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE TABLE "Role" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(500) NOT NULL,
    description TEXT,
    status "RoleStatus",
    "createdById" UUID REFERENCES "User" (id) NOT NULL,
    "updatedById" UUID REFERENCES "User" (id),
    "deletedById" UUID REFERENCES "User" (id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE TABLE "RolePermission" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "roleId" UUID REFERENCES "Role" (id) NOT NULL,
    "permissionId" UUID REFERENCES "Permission" (id) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_idx" ON "RolePermission" ("roleId", "permissionId") WHERE "deletedAt" IS NULL;

CREATE TABLE "UserRole" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID REFERENCES "User" (id) NOT NULL,
    "roleId" UUID REFERENCES "Role" (id) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX "UserRole_userId_roleId_idx" ON "UserRole" ("userId", "roleId") WHERE "deletedAt" IS NULL;
