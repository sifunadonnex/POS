import { SetMetadata } from '@nestjs/common';

export const PUBLIC = 'paygo:public';
export const ROLES = 'paygo:roles';
export const SECURITY_SETUP = 'paygo:security-setup';
export const SecuritySetup = () => SetMetadata(SECURITY_SETUP, true);
export const PublicRoute = () => SetMetadata(PUBLIC, true);
export type StaffRole = 'manager' | 'cashier';
export const StaffRoles = (...roles: StaffRole[]) => SetMetadata(ROLES, roles);
