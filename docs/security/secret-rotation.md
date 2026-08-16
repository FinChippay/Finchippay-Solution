# Secret Rotation Runbook

This document provides procedures for rotating all types of secrets used in the Finchippay platform. If any secret is leaked or compromised, follow the appropriate rotation procedure immediately.

## Table of Contents

- [Stellar Keys](#stellar-keys)
- [JWT Secrets](#jwt-secrets)
- [Database Credentials](#database-credentials)
- [API Keys](#api-keys)
- [AWS Credentials](#aws-credentials)
- [Emergency Response](#emergency-response)

## Stellar Keys

### Identification
Stellar secret keys (private keys) follow the pattern: `S[A-Z0-9]{55}`

### Rotation Procedure

1. **Immediate Actions**
   ```bash
   # Identify affected wallet addresses
   # Check recent transactions for suspicious activity
   # Freeze affected accounts if necessary
   ```

2. **Generate New Key Pair**
   ```bash
   # Using Stellar SDK
   const pair = StellarSdk.Keypair.random();
   console.log('Public Key:', pair.publicKey());
   console.log('Secret Key:', pair.secret());
   ```

3. **Update Configuration**
   - Update environment variables: `STELLAR_SECRET_KEY`
   - Update any hardcoded references in code (should be none)
   - Update CI/CD secrets in GitHub/GitLab/AWS Secrets Manager

4. **Asset Migration** (if holding assets)
   ```bash
   # Transfer assets from old key to new key
   # Ensure sufficient XLM for transaction fees
   # Verify transaction completion
   ```

5. **Update Dependencies**
   - Update any services that depend on the old key
   - Update smart contract integrations
   - Update API authentication configurations

6. **Verification**
   ```bash
   # Test new key with a small transaction
   # Verify authentication works
   # Monitor for any authentication failures
   ```

7. **Cleanup**
   - Remove old key from all systems
   - Update documentation if key was documented
   - Communicate with team about the change

### Timeline
- **Critical**: 1-2 hours (immediate rotation)
- **Non-critical**: During next maintenance window

## JWT Secrets

### Identification
JWT secrets are used for token signing and verification. They may appear as:
- `JWT_SECRET=...`
- `jwt_secret=...`
- Base64-encoded strings in configuration files

### Rotation Procedure

1. **Generate New Secret**
   ```bash
   # Generate a secure random secret (32+ bytes)
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

2. **Update Configuration**
   - Update environment variable: `JWT_SECRET`
   - Update secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
   - Update CI/CD pipeline secrets

3. **Handle Existing Tokens**
   - **Option A (Immediate)**: Invalidate all existing tokens
     - Users will need to re-authenticate
     - Fastest but impacts user experience
   
   - **Option B (Gradual)**: Support both old and new secrets temporarily
     - Update code to try both secrets for verification
     - Allow existing tokens to expire naturally
     - Remove old secret after token expiration period

4. **Update Application Code** (if using Option B)
   ```javascript
   // Example: Support multiple secrets during transition
   const secrets = [process.env.JWT_SECRET, process.env.JWT_SECRET_OLD];
   // Try each secret for verification
   ```

5. **Verification**
   - Test token generation with new secret
   - Test token verification with new secret
   - Monitor authentication logs for failures

6. **Cleanup**
   - Remove old secret after transition period
   - Update documentation
   - Rotate any backup copies

### Timeline
- **Critical**: 1-4 hours (immediate rotation)
- **Non-critical**: 24-48 hours (gradual rotation to minimize disruption)

## Database Credentials

### Identification
Database connection strings follow patterns like:
- `mongodb://user:password@host:port/database`
- `mysql://user:password@host:port/database`
- `postgres://user:password@host:port/database`

### Rotation Procedure

1. **Prepare New Credentials**
   ```bash
   # Generate strong password (32+ characters, mixed case, numbers, symbols)
   # Example for MongoDB
   use admin
   db.createUser({
     user: "new_user",
     pwd: "new_secure_password",
     roles: [{ role: "readWrite", db: "finchippay" }]
   })
   ```

2. **Update Configuration**
   - Update environment variables: `DATABASE_URL`, `MONGODB_URI`, etc.
   - Update secrets manager
   - Update CI/CD pipeline secrets

3. **Application Deployment**
   - Deploy configuration changes
   - Monitor application logs for connection errors
   - Verify database connectivity

4. **Cleanup Old Credentials**
   ```bash
   # After successful deployment (24-48 hours later)
   # Remove old database user
   use admin
   db.dropUser("old_user")
   ```

5. **Verification**
   - Test database operations
   - Monitor performance metrics
   - Check for any connection issues

### Timeline
- **Critical**: 2-6 hours
- **Non-critical**: During next maintenance window

## API Keys

### Identification
API keys may appear as:
- `sk-...` (Stripe-like)
- `AKIA...` (AWS-like)
- Custom patterns for various services

### Rotation Procedure

1. **Identify Affected Services**
   - List all services using the compromised key
   - Determine rate limits and quotas
   - Identify any dependencies

2. **Generate New Keys**
   - Generate new API keys from service dashboards
   - Note any quota or rate limit differences
   - Document new key locations

3. **Update Configuration**
   - Update environment variables
   - Update secrets manager
   - Update CI/CD pipeline secrets
   - Update any hardcoded references (should be none)

4. **Test New Keys**
   - Verify authentication works
   - Test rate limits
   - Check service-specific functionality

5. **Revoke Old Keys**
   - Revoke old keys from service dashboards
   - Monitor for any service disruptions
   - Update any dependent services

6. **Verification**
   - Monitor application logs
   - Check for authentication failures
   - Verify all services are functioning

### Timeline
- **Critical**: 2-8 hours (varies by service)
- **Non-critical**: During next maintenance window

## AWS Credentials

### Identification
AWS credentials appear as:
- `AWS_ACCESS_KEY_ID=AKIA...`
- `AWS_SECRET_ACCESS_KEY=...`
- In `.aws/credentials` files

### Rotation Procedure

1. **Identify Affected IAM Users/Roles**
   ```bash
   # Using AWS CLI
   aws iam list-access-keys --user-name username
   ```

2. **Create New Access Keys**
   ```bash
   # Create new access key
   aws iam create-access-key --user-name username
   ```

3. **Update Configuration**
   - Update environment variables
   - Update AWS CLI configuration
   - Update application configuration
   - Update CI/CD pipeline secrets

4. **Test New Credentials**
   ```bash
   # Test new credentials
   aws sts get-caller-identity
   ```

5. **Revoke Old Credentials**
   ```bash
   # After successful deployment (24-48 hours)
   aws iam delete-access-key --user-name username --access-key-id OLD_KEY_ID
   ```

6. **Verification**
   - Monitor CloudTrail logs
   - Check for authentication failures
   - Verify all AWS services are accessible

### Timeline
- **Critical**: 2-6 hours
- **Non-critical**: During next maintenance window

## Emergency Response

### Immediate Actions (First 15 Minutes)

1. **Assess Impact**
   - Determine scope of exposure
   - Identify affected systems
   - Estimate potential damage

2. **Activate Incident Response**
   - Notify security team
   - Create incident ticket
   - Start communication log

3. **Containment**
   - Disable affected accounts/keys if possible
   - Implement temporary restrictions
   - Increase monitoring

### Short-term Actions (First 24 Hours)

1. **Full Rotation**
   - Rotate all potentially compromised secrets
   - Follow procedures above
   - Document all changes

2. **Investigation**
   - Determine how the leak occurred
   - Identify vulnerable code or processes
   - Review access logs

3. **Communication**
   - Notify affected parties if required
   - Update team on status
   - Document incident timeline

### Long-term Actions (Weeks to Months)

1. **Prevention**
   - Implement additional security controls
   - Update training and procedures
   - Review and improve secret management

2. **Monitoring**
   - Enhanced monitoring for suspicious activity
   - Regular secret scanning
   - Periodic security audits

3. **Documentation**
   - Update incident response procedures
   - Create lessons learned document
   - Share findings with team

## Prevention Measures

### Technical Controls

1. **Secret Scanning**
   - CI/CD pipeline with gitleaks (configured in `.github/workflows/ci-validate.yml`)
   - Pre-commit hooks (configured in `.husky/pre-commit`)
   - Regular repository scans

2. **Secret Management**
   - Use environment variables for runtime secrets
   - Use secrets manager (AWS Secrets Manager, HashiCorp Vault)
   - Never commit secrets to version control

3. **Access Control**
   - Principle of least privilege
   - Regular access reviews
   - Multi-factor authentication

### Process Controls

1. **Training**
   - Security awareness training
   - Secret handling procedures
   - Incident response training

2. **Documentation**
   - Keep this runbook updated
   - Document all secret-related changes
   - Maintain an inventory of secrets

3. **Auditing**
   - Regular security audits
   - Secret access logging
   - Compliance reviews

## Contact Information

For security incidents:
- **Email**: security@finchippay.dev
- **PGP Key**: See `security-pgp-key.asc` in this directory
- **Response Time**: See table in [README.md](./README.md)

## References

- [Stellar Documentation](https://developers.stellar.org/)
- [OWASP Secret Scanning](https://owasp.org/www-community/Secrets_Detection)
- [AWS Security Best Practices](https://docs.aws.amazon.com/security/)
- [Gitleaks Documentation](https://github.com/gitleaks/gitleaks)

---

**Last Updated**: 2026-08-16  
**Version**: 1.0  
**Maintained By**: Finchippay Security Team