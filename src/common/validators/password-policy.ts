/**
 * Length policy for passwords being SET (user creation, self-service change,
 * admin reset). Every account here is a staff account with CMS write access,
 * so the floor is 10 rather than the previous 6.
 *
 * Login deliberately does NOT enforce the minimum: accounts created under the
 * old floor must still be able to sign in (and then change their password).
 *
 * bcrypt truncates at 72 bytes; the cap sits well above that only to bound
 * hashing work on hostile input.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
