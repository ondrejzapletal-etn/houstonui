import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'
/**
 * Označí endpoint jako veřejný (nevyžaduje JWT auth)
 * Použití: @Public() před @Controller nebo @Get/@Post metodou
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
