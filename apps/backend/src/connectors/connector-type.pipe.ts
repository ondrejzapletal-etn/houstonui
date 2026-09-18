/**
 * ConnectorTypeParam – PipeTransform that parses and validates the
 * :type route parameter into a ConnectorType enum value.
 *
 * Accepts: "gmail" | "slack" | "jira" | "clockify" (case-insensitive)
 * Throws:  BadRequestException for unknown connector types
 */

import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common'
import { ConnectorType } from '@prisma/client'

@Injectable()
export class ConnectorTypeParam implements PipeTransform<string, ConnectorType> {
  transform(value: string): ConnectorType {
    const upper = value.toUpperCase()
    if (upper === ConnectorType.GMAIL) return ConnectorType.GMAIL
    if (upper === ConnectorType.SLACK) return ConnectorType.SLACK
    if (upper === ConnectorType.JIRA) return ConnectorType.JIRA
    if (upper === ConnectorType.CLOCKIFY) return ConnectorType.CLOCKIFY
    if (upper === ConnectorType.HOTSPOT) return ConnectorType.HOTSPOT

    throw new BadRequestException(
      `Unknown connector type "${value}". Supported: gmail, slack, jira, clockify, hotspot.`,
    )
  }
}
