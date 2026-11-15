$ErrorActionPreference = 'Stop'
try {
    $previewRoot = $PSScriptRoot
    $appRoot = Join-Path $previewRoot 'app'
    foreach ($name in @('OPENAI_API_KEY','AION_OPENAI_KEY','ANTHROPIC_API_KEY','CLAUDE_API_KEY','AION_ANTHROPIC_KEY','CEREBRAS_API_KEY','AION_CEREBRAS_KEY','GROQ_API_KEY','AION_GROQ_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','AION_GEMINI_KEY','AION_TEST_VAULT_KEY','OLLAMA_HOST','OLLAMA_API_BASE','SYNCTHING_API_KEY','AION_LOCAL_AUTH_SECRET')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    $env:AION_BIND_HOST = '127.0.0.1'
    $env:AION_DEVICES_PATH = Join-Path $appRoot 'data\devices.json'
    $env:AION_SECURITY_DB_PATH = Join-Path $appRoot 'data\security.sqlite'
    $env:AION_ASSISTANT_DB_PATH = Join-Path $appRoot 'data\assistant.sqlite'
    $env:AION_REPLICATION_DB_PATH = Join-Path $appRoot 'data\replication.sqlite'
    $env:AION_TRANSPORT_IDENTITY_PATH = Join-Path $appRoot 'data\transport-identity.dpapi'
    $env:AION_VAULT_DIR = Join-Path $appRoot 'data'
    $env:SYNCTHING_CONFIG_PATH = Join-Path $appRoot 'data\no-syncthing.xml'
    $env:SYNCTHING_PORT = '1'
    $env:AION_WEBVIEW2_DATA_PATH = Join-Path $previewRoot 'webview2-data'
    $env:AION_INSTANCE_ID = 'isolated-development-preview'
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start(); $env:AION_PORT = [string]$listener.LocalEndpoint.Port; $listener.Stop()
    Start-Process -FilePath (Join-Path $appRoot 'AION.exe') -WorkingDirectory $appRoot | Out-Null
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'AION preview could not start', 'OK', 'Error') | Out-Null
    exit 1
}
