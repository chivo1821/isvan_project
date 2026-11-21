# Cierra los servidores locales de desarrollo (Next.js en :3000/:3001, FastAPI/uvicorn en :8010/:8001).
# Uso: npm run stop
#
# La API de desarrollo usa el 8010 (o 8001 en dev:admin) y NO el 8000: en el
# 8000 publica Docker Desktop la API de SIGAT, que no se debe tocar desde aqui.
#
# Solo se cierran los procesos que escuchan en estos puertos y sus
# descendientes. Nunca todos los python/node de la maquina.

$puertos = 3000, 3001, 8001, 8010

function Get-Escuchando {
    Get-NetTCPConnection -LocalPort $puertos -State Listen -ErrorAction SilentlyContinue
}

function Stop-Arbol([int[]]$raices) {
    # uvicorn --reload en Windows usa multiprocessing: el proceso que tiene el
    # socket puede ser un hijo ("spawn_main(parent_pid=N)") cuyo padre ya
    # murio, y Windows sigue mostrando como duenio del puerto el PID muerto.
    # Por eso se buscan tambien los hijos por ParentProcessId y por el
    # parent_pid de su linea de comandos, en cascada.
    $procesos = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    $pendientes = [System.Collections.Generic.Queue[int]]::new()
    $vistos = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($r in $raices) { $pendientes.Enqueue($r) }
    while ($pendientes.Count -gt 0) {
        $pid_ = $pendientes.Dequeue()
        if (-not $vistos.Add($pid_)) { continue }
        foreach ($p in $procesos) {
            if ($p.ParentProcessId -eq $pid_ -or ($p.CommandLine -and $p.CommandLine -match "parent_pid=$pid_\b")) {
                $pendientes.Enqueue([int]$p.ProcessId)
            }
        }
    }
    foreach ($pid_ in $vistos) {
        if ($pid_ -gt 4) { Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue }
    }
}

Write-Output "Cerrando servidores locales..."

for ($intento = 1; $intento -le 2; $intento++) {
    $duenios = Get-Escuchando | Select-Object -ExpandProperty OwningProcess -Unique
    if (-not $duenios) { break }
    Stop-Arbol $duenios
    Start-Sleep -Seconds 1
}

$final = Get-Escuchando
if ($final) {
    Write-Output "Atencion: siguen escuchando estos puertos:"
    $final | Format-Table LocalPort, OwningProcess
} else {
    Write-Output "Listo. Puertos 3000/3001 y 8010/8001 liberados."
}
