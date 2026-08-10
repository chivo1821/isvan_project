# Cierra los servidores locales de desarrollo (Next.js en :3000, FastAPI/uvicorn en :8000).
# Uso: npm run stop

Write-Output "Cerrando servidores locales..."

# 1) Intento limpio: matar por puerto.
Get-NetTCPConnection -LocalPort 3000, 8000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

# 2) Respaldo: uvicorn --reload en Windows usa multiprocessing y puede dejar un
# proceso hijo huerfano (su PID "padre" ya no existe) que sigue escuchando en
# el puerto. Si el paso 1 no alcanzo, se cierran todos los procesos python/node
# restantes (asumido seguro: maquina de desarrollo, sin otros procesos criticos).
$quedan = Get-NetTCPConnection -LocalPort 3000, 8000 -State Listen -ErrorAction SilentlyContinue
if ($quedan) {
    Get-Process python, node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

$final = Get-NetTCPConnection -LocalPort 3000, 8000 -State Listen -ErrorAction SilentlyContinue
if ($final) {
    Write-Output "Atencion: siguen escuchando estos puertos:"
    $final | Format-Table LocalPort, OwningProcess
} else {
    Write-Output "Listo. Puertos 3000 y 8000 liberados."
}
