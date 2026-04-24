cd C:\presentation-host

echo Updating code...
git pull

set SERVER_URL=wss://remote.mvapphub.com
set ROOM_CODE=ROOM1

node windows_host_app.js

pause