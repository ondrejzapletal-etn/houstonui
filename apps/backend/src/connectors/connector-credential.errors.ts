/**
 * Custom exceptions for the Connectors module.
 *
 * These are NestJS HttpExceptions so they propagate correctly through the
 * global exception filter and are typed for catch-blocks.
 */

import { HttpException, HttpStatus } from '@nestjs/common'

/** The credential record or Key Vault secret does not exist. */
export class CredentialNotFoundException extends HttpException {
  constructor(message?: string) {
    super(message ?? 'Connector credential not found.', HttpStatus.NOT_FOUND)
  }
}

/**
 * The credential exists in Key Vault but is disabled, deleted, or has no
 * value – caller must trigger re-authorisation.
 */
export class CredentialInvalidException extends HttpException {
  constructor(message?: string) {
    super(
      message ?? 'Connector credential is invalid. Re-authorisation required.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    )
  }
}

/**
 * The credential has expired (access token TTL exceeded) and cannot be
 * used until it is refreshed or the user re-authorises.
 */
export class CredentialExpiredException extends HttpException {
  constructor(message?: string) {
    super(
      message ?? 'Connector credential has expired. Re-authorisation required.',
      HttpStatus.UNAUTHORIZED,
    )
  }
}
