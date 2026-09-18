import {
  BadGatewayException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConnectorType } from '@prisma/client'
import { ConnectorCredentialsService } from '../connector-credentials.service'
import { CredentialInvalidException } from '../connector-credential.errors'

const HOT_SPOT_ALLOCATIONS_URL = 'https://hot.etn.cz/api/allocations'

interface HotSpotAllocation {
  employeeId: string
  date: string
  half: 'am' | 'pm'
  allocationType: string
}

interface HotSpotAllocationsResponse {
  data: HotSpotAllocation[]
}

@Injectable()
export class HotSpotService {
  constructor(private readonly credentials: ConnectorCredentialsService) {}

  async connectWithApiKey(userId: string, apiKey: string, employeeId: string): Promise<void> {
    const today = new Date().toISOString().substring(0, 10)
    await this.fetchAllocations(apiKey, employeeId, today, today, true)
    await this.credentials.storeCredential({
      userId,
      connectorType: ConnectorType.HOTSPOT,
      accessToken: apiKey,
      refreshToken: '',
      scopes: ['allocations:read'],
      externalAccountId: employeeId,
    })
  }

  async getVacationSeconds(
    userId: string,
    year: number,
    month: number,
    workingDayHours: number,
  ): Promise<number> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.HOTSPOT)
    const metadata = await this.credentials.getMetadata(userId, ConnectorType.HOTSPOT)
    const employeeId = metadata.externalAccountId
    if (!employeeId) {
      throw new CredentialInvalidException('HOT SPOT credential is missing employeeId. Please reconnect.')
    }

    const from = `${year}-${String(month).padStart(2, '0')}-01`
    const now = new Date()
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month
    const lastDay = isCurrentMonth ? now.getDate() : new Date(Date.UTC(year, month, 0)).getUTCDate()
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    const allocations = await this.fetchAllocations(tokens.accessToken, employeeId, from, to, false)
    const vacationSlots = new Set(
      allocations
        .filter(
          (allocation) =>
            allocation.employeeId === employeeId &&
            allocation.date >= from &&
            allocation.date <= to &&
            allocation.allocationType.toLowerCase() === 'vacation' &&
            (allocation.half === 'am' || allocation.half === 'pm'),
        )
        .map((allocation) => `${allocation.employeeId}:${allocation.date}:${allocation.half}`),
    )

    return Math.round(vacationSlots.size * workingDayHours * 1800)
  }

  async isInternalNetworkAvailable(userId: string): Promise<boolean> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.HOTSPOT)
    const metadata = await this.credentials.getMetadata(userId, ConnectorType.HOTSPOT)
    const employeeId = metadata.externalAccountId
    if (!employeeId) {
      throw new CredentialInvalidException('HOT SPOT credential is missing employeeId. Please reconnect.')
    }

    const today = new Date().toISOString().substring(0, 10)
    try {
      await this.fetchAllocations(tokens.accessToken, employeeId, today, today, false)
      return true
    } catch (error: unknown) {
      if (error instanceof BadGatewayException) return false
      throw error
    }
  }

  private async fetchAllocations(
    apiKey: string,
    employeeId: string,
    from: string,
    to: string,
    isConnectionValidation: boolean,
  ): Promise<HotSpotAllocation[]> {
    const url = new URL(HOT_SPOT_ALLOCATIONS_URL)
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    url.searchParams.set('employeeId', employeeId)

    let response: Response
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    } catch {
      throw new BadGatewayException('HOT SPOT API is unavailable')
    }

    if (response.status === 401) {
      if (isConnectionValidation) {
        throw new UnprocessableEntityException('HOT SPOT API key is invalid or rate-limited')
      }
      throw new UnauthorizedException('HOT SPOT API key is invalid or rate-limited')
    }
    if (!response.ok) {
      throw new BadGatewayException(`HOT SPOT API request failed (${response.status})`)
    }

    const payload = await response.json() as unknown
    if (!this.isAllocationsResponse(payload)) {
      throw new BadGatewayException('HOT SPOT API returned an invalid response')
    }
    return payload.data
  }

  private isAllocationsResponse(value: unknown): value is HotSpotAllocationsResponse {
    if (typeof value !== 'object' || value === null || !Array.isArray((value as { data?: unknown }).data)) {
      return false
    }
    return (value as { data: unknown[] }).data.every((entry) => {
      if (typeof entry !== 'object' || entry === null) return false
      const allocation = entry as Record<string, unknown>
      return typeof allocation.employeeId === 'string' &&
        typeof allocation.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(allocation.date) &&
        (allocation.half === 'am' || allocation.half === 'pm') &&
        typeof allocation.allocationType === 'string'
    })
  }
}