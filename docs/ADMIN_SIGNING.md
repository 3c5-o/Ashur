# Ashur Admin signing policy

- Application ID: `app.ashur.admin`
- New primary signing key starts with **Admin 1.3.2 / versionCode 6**.
- Certificate SHA-256: `59E717D4967D903E99B900F837562F316E13C21ACF07CAC51587CE655D286AC7`.
- Every future **Admin** release must use this exact certificate.
- This Admin key must never be used for the Ashur User application.
- The previous Admin signing key is intentionally retired. Existing installs signed with the previous key require a one-time uninstall before installing 1.3.2.
- After 1.3.2 is installed, future Admin releases signed with this same key can update it normally.
- Private keystore material is intentionally not stored in this repository.
