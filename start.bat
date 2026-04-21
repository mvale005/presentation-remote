cd C:\presentation-host

echo Updating code...
git pull

echo Clearing local slides...
if exist C:\presentation-host\public\slides (
    del /Q C:\presentation-host\public\slides\*.PNG
)

echo Local slides cleared.

set SERVER_URL=wss://remote.mvapphub.com
set ROOM_CODE=ROOM1

node windows_host_app.js

pause