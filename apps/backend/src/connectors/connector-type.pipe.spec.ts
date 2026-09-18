import { BadRequestException } from '@nestjs/common'
import { ConnectorType } from '@prisma/client'
import { ConnectorTypeParam } from './connector-type.pipe'

describe('ConnectorTypeParam', () => {
  let pipe: ConnectorTypeParam

  beforeEach(() => {
    pipe = new ConnectorTypeParam()
  })

  it('parses "gmail" (lowercase) to ConnectorType.GMAIL', () => {
    expect(pipe.transform('gmail')).toBe(ConnectorType.GMAIL)
  })

  it('parses "GMAIL" (uppercase) to ConnectorType.GMAIL', () => {
    expect(pipe.transform('GMAIL')).toBe(ConnectorType.GMAIL)
  })

  it('parses "slack" (lowercase) to ConnectorType.SLACK', () => {
    expect(pipe.transform('slack')).toBe(ConnectorType.SLACK)
  })

  it('parses "SLACK" (uppercase) to ConnectorType.SLACK', () => {
    expect(pipe.transform('SLACK')).toBe(ConnectorType.SLACK)
  })

  it('parses "jira" (lowercase) to ConnectorType.JIRA', () => {
    expect(pipe.transform('jira')).toBe(ConnectorType.JIRA)
  })

  it('parses "JIRA" (uppercase) to ConnectorType.JIRA', () => {
    expect(pipe.transform('JIRA')).toBe(ConnectorType.JIRA)
  })

  it('throws BadRequestException for unknown connector type', () => {
    expect(() => pipe.transform('unknown-connector')).toThrow(BadRequestException)
  })

  it('includes the invalid value in the error message', () => {
    try {
      pipe.transform('unknown')
    } catch (err) {
      expect((err as BadRequestException).message).toContain('unknown')
    }
  })
})
