import { describe, test } from 'node:test'
import * as assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { sanitizeToken } from '../../src/utils/error-formatter.js'

// House rule: no secret-shaped material (real, test, or synthetic) is ever
// committed. Dummy tokens below are generated at runtime as base64url
// strings with the same structural shape as the tokens they imitate.
const dummyToken = (bytes = 9) => randomBytes(bytes).toString('base64url')
const dummyShortToken = () => randomBytes(4).toString('base64url')

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
    const token = dummyShortToken()
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
    const token = dummyShortToken()
    // Build a case-mismatched variant that is guaranteed to differ from the
    // token even in the rare case the generated token is all-upper-case.
    const variant =
      token.toUpperCase() === token ? `X${token}` : token.toUpperCase()
    const message = `Token ${variant} is valid`

    // Act
    const result = sanitizeToken(message, token)

    // Assert
    assert.strictEqual(result, message)
  })
})
