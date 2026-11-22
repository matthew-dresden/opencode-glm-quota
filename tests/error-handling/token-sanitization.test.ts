import { describe, test } from 'node:test'
import * as assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { sanitizeToken } from '../../src/utils/error-formatter.js'

// House rule (opencode-estate SPEC C3): no secret-shaped literals in code or
// history. Dummy tokens are generated at runtime — never stored.
function dummyToken(byteLength = 9): string {
  return randomBytes(byteLength).toString('base64url')
}

describe('sanitizeToken', () => {
  test('replaces token with *** when token appears in message', () => {
    // Arrange
    const token = dummyToken()
    const message = `Authentication failed with token ${token}`

    // Act
    const result = sanitizeToken(message, token)

    // Assert
    assert.strictEqual(result, 'Authentication failed with token ***')
  })

  test('returns original message when token is undefined', () => {
    // Arrange
    const message = 'Authentication failed'

    // Act
    const result = sanitizeToken(message, undefined)

    // Assert
    assert.strictEqual(result, 'Authentication failed')
  })

  test('returns original message when token is not in message', () => {
    // Arrange
    const message = 'Authentication failed'
    const token = dummyToken()

    // Act
    const result = sanitizeToken(message, token)

    // Assert
    assert.strictEqual(result, 'Authentication failed')
  })

  test('replaces all occurrences of token in message', () => {
    // Arrange
    const token = dummyToken(6)
    const message = `Token ${token} used in header. Token ${token} expired.`

    // Act
    const result = sanitizeToken(message, token)

    // Assert
    assert.strictEqual(result, 'Token *** used in header. Token *** expired.')
  })

  test('handles empty token gracefully', () => {
    // Arrange
    const message = 'Authentication failed'
    const token = ''

    // Act
    const result = sanitizeToken(message, token)

    // Assert
    assert.strictEqual(result, 'Authentication failed')
  })

  test('is case-sensitive when matching tokens', () => {
    // Arrange
    // 'x' prefix guarantees at least one case-mappable character, so the
    // uppercase variant of the token can never equal the token itself.
    const token = `x${dummyToken(6).toLowerCase()}`
    const message = `Token ${token.toUpperCase()} is valid`

    // Act
    const result = sanitizeToken(message, token)

    // Assert
    assert.strictEqual(result, `Token ${token.toUpperCase()} is valid`)
  })
})
