// pm-copilot backend — Azure Container Apps deploy.
//
// Provisions:
//   - A Log Analytics workspace (required by Container Apps for logs)
//   - A Container Apps Environment with an Azure Files share for persistence
//   - A storage account + file share for the cache + claude /login state
//   - The Container App itself with two volume mounts:
//       /var/data/cache  → cache subdirectory of the share (CACHE_DIR)
//       /root/.claude    → claude-auth subdirectory (anthropic-cc state)
//
// CORS, env vars, and (optional) provider secrets are passed in as
// parameters so the same template covers preview + production with
// different values.
//
// Deploy via infra/azure/deploy.sh.

@description('Resource name prefix. Defaults to pm-copilot.')
param namePrefix string = 'pm-copilot'

@description('Azure region. Default eastus.')
param location string = resourceGroup().location

@description('Container image to deploy (e.g. ghcr.io/<you>/pm-copilot-api:latest).')
param image string

@description('CORS allowed origin — set to the Cloudflare Pages frontend URL.')
param corsOrigin string

@description('Brief cache TTL in milliseconds. 15 minutes by default per the cf-azure-rewrite plan.')
param briefCacheTtlMs string = '900000'

@description('Optional Anthropic API key (BYOK; if set, takes precedence over claude-cc subprocess auth).')
@secure()
param anthropicApiKey string = ''

@description('Optional OpenAI API key.')
@secure()
param openaiApiKey string = ''

@description('Optional Perplexity API key.')
@secure()
param perplexityApiKey string = ''

@description('Optional xAI / Grok API key.')
@secure()
param xaiApiKey string = ''

// ---------- Storage (Azure Files) ----------
//
// Standard tier file share. Quota is generous; persist.ts writes ~5 MB
// total under steady state. The share is mounted into the container at
// two distinct subpaths (cache + claude-auth) so a single share can hold
// both pieces of persistent state.

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: '${replace(namePrefix, '-', '')}sa'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource storageFileService 'Microsoft.Storage/storageAccounts/fileServices@2023-01-01' = {
  parent: storage
  name: 'default'
}

resource cacheShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  parent: storageFileService
  name: '${namePrefix}-cache'
  properties: {
    shareQuota: 5
    enabledProtocols: 'SMB'
  }
}

// ---------- Logs ----------

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---------- Container Apps Environment + storage link ----------

resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource caEnvStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: caEnv
  name: 'cache-share'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: cacheShare.name
      accessMode: 'ReadWrite'
    }
  }
}

// ---------- The Container App ----------
//
// Single-replica scale-to-zero. anthropic-cc's claude /login state is
// keyed to /root/.claude on the volume — running multiple replicas
// would race on that. If you need to scale out, switch the Anthropic
// path to API key only (set anthropicApiKey above) and bump
// scale.maxReplicas.

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api'
  location: location
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8787
        transport: 'auto'
        corsPolicy: {
          allowedOrigins: [ corsOrigin ]
          allowedMethods: [ 'GET', 'POST', 'OPTIONS' ]
          allowedHeaders: [
            'content-type', 'accept'
            'x-llm-key', 'x-llm-provider'
            'x-perplexity-key', 'x-xai-key'
          ]
          allowCredentials: false
          maxAge: 3600
        }
      }
      secrets: concat(
        [],
        empty(anthropicApiKey)   ? [] : [ { name: 'anthropic-api-key',   value: anthropicApiKey } ],
        empty(openaiApiKey)      ? [] : [ { name: 'openai-api-key',      value: openaiApiKey } ],
        empty(perplexityApiKey)  ? [] : [ { name: 'perplexity-api-key',  value: perplexityApiKey } ],
        empty(xaiApiKey)         ? [] : [ { name: 'xai-api-key',         value: xaiApiKey } ]
      )
    }
    template: {
      containers: [
        {
          name: 'pm-copilot-api'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(
            [
              { name: 'NODE_ENV',           value: 'production' }
              { name: 'PORT',               value: '8787' }
              { name: 'CORS_ORIGIN',        value: corsOrigin }
              { name: 'CACHE_DIR',          value: '/var/data/cache' }
              { name: 'BRIEF_CACHE_TTL_MS', value: briefCacheTtlMs }
            ],
            empty(anthropicApiKey)  ? [] : [ { name: 'ANTHROPIC_API_KEY',  secretRef: 'anthropic-api-key' } ],
            empty(openaiApiKey)     ? [] : [ { name: 'OPENAI_API_KEY',     secretRef: 'openai-api-key' } ],
            empty(perplexityApiKey) ? [] : [ { name: 'PERPLEXITY_API_KEY', secretRef: 'perplexity-api-key' } ],
            empty(xaiApiKey)        ? [] : [ { name: 'XAI_API_KEY',        secretRef: 'xai-api-key' } ]
          )
          volumeMounts: [
            { volumeName: 'cache-vol',       mountPath: '/var/data/cache' }
            { volumeName: 'claude-auth-vol', mountPath: '/root/.claude' }
          ]
        }
      ]
      // Two named volumes, both backed by the same Azure Files share, mounted
      // at different subpaths inside the container. Container Apps doesn't
      // support subpath mounts directly so each named volume just maps to a
      // sub-prefix the app writes under.
      volumes: [
        { name: 'cache-vol',       storageType: 'AzureFile', storageName: caEnvStorage.name }
        { name: 'claude-auth-vol', storageType: 'AzureFile', storageName: caEnvStorage.name }
      ]
      scale: { minReplicas: 0, maxReplicas: 1 }
    }
  }
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output storageAccountName string = storage.name
output cacheShareName string = cacheShare.name
