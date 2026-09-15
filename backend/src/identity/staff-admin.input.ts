import { BadRequestException } from '@nestjs/common';

export function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid request');
  return Object.fromEntries(Object.entries(value));
}

export function textInput(
  value: unknown,
  label: string,
  max: number,
  min = 1,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < min ||
    value.trim().length > max ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new BadRequestException(`Provide a valid ${label}`);
  }
  return value.trim();
}

export function confirmInput(value: unknown) {
  const body = objectInput(value);
  if (
    typeof body.password !== 'string' ||
    body.password.length < 12 ||
    body.password.length > 128
  )
    throw new BadRequestException('Confirm your current password');
  return {
    password: body.password,
    reason: textInput(body.reason, 'reason', 200, 3),
  };
}

export function staffInput(value: unknown, update = false) {
  const body = objectInput(value);
  const allowed = update
    ? ['name', 'role', 'disabled', 'revision', 'password', 'reason']
    : ['name', 'email', 'role', 'password', 'reason'];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new BadRequestException('Unexpected staff field');
  if (body.role !== 'manager' && body.role !== 'cashier')
    throw new BadRequestException('Choose manager or cashier');
  const role = body.role;
  const name = textInput(body.name, 'name', 100);
  return { ...confirmInput(value), name, role };
}

export function emailInput(value: unknown): string {
  const email = textInput(value, 'email', 254).toLowerCase();
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))
    throw new BadRequestException('Provide a valid email');
  return email;
}

export function staffId(value: unknown): string {
  const id = textInput(value, 'staff ID', 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new BadRequestException('Invalid staff ID');
  return id;
}
