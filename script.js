// Variables globales
let ua; // User Agent de JsSIP
let currentSession; // SesiÃ³n de llamada activa (establecida o saliente timbrando)
let heldSession = null; // SesiÃ³n de llamada en espera (para nueva llamada/transferencia)
let incomingSessionCandidate = null; // SesiÃ³n entrante esperando ser respondida (para el popup)
let remoteAudio; // Elemento de audio para reproducir el audio remoto
let localStream; // Stream de medios local (micrÃ³fono)
let isMuted = false;
let isHeld = false;
let notificationPermissionGranted = false; // Estado del permiso de notificaciones

// ConfiguraciÃ³n SIP predeterminada (se sobreescribirÃ¡ con config.json)
const sipConfig = {
    sipDomain: "",
    sipUser: "",
    sipPassword: "",
    wsServer: "",
    autoRegister: true
};

// Elementos DOM
const btnToggleRegister = document.getElementById('btnToggleRegister');
const mainCallActionButton = document.getElementById('mainCallActionButton'); // BotÃ³n principal de acciÃ³n (Llamar/Colgar/Descolgar)
const btnMute = document.getElementById('btnMute');
const btnHold = document.getElementById('btnHold');
const btnTransfer = document.getElementById('btnTransfer');
const transferTarget = document.getElementById('transferTarget'); // Input para transferencia ciega
const btnAttendedTransfer = document.getElementById('btnAttendedTransfer');
const attendedTransferTarget = document.getElementById('attendedTransferTarget'); // Input para transferencia atendida
const backspaceButton = document.getElementById('backspaceButton');
const clearNumberButton = document.getElementById('clearNumberButton'); // Ahora es el icono 'x' para borrar todo
const btnNewCall = document.getElementById('btnNewCall'); // BotÃ³n de Nueva Llamada (para iniciar segunda llamada)

const statusElement = document.getElementById('status');
const callInfoElement = document.getElementById('callInfo');
const eventLogElement = document.getElementById('eventLog');
const numberToCallInput = document.getElementById('numberToCall'); // Ahora es un div contenteditable para el nÃºmero principal
const digitButtons = document.querySelectorAll('.digit');
const configStatusElement = document.getElementById('configStatus');

// Nuevos elementos para el popup de llamada entrante
const incomingCallPopup = document.getElementById('incomingCallPopup');
const incomingCallInfo = document.getElementById('incomingCallInfo');
const btnAnswerPopup = document.getElementById('btnAnswerPopup');
const btnRejectPopup = document.getElementById('btnRejectPopup');

// Secciones de control
const inCallControls = document.getElementById('inCallControls');
const transferControls = document.getElementById('transferControls');

// InicializaciÃ³n al cargar la ventana
window.addEventListener('load', () => {
    appendToLog("Cargando softphone...");

    // Crear elemento de audio para reproducir audio remoto
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;
    document.body.appendChild(remoteAudio);

    // Escuchar eventos de los botones y campos de entrada
    btnToggleRegister.addEventListener('click', toggleRegister);
    mainCallActionButton.addEventListener('click', handleMainCallAction);
    btnMute.addEventListener('click', toggleMute);
    btnHold.addEventListener('click', toggleHold);
    btnTransfer.addEventListener('click', blindTransfer);
    btnAttendedTransfer.addEventListener('click', attendedTransfer);
    btnAnswerPopup.addEventListener('click', answerCall);
    btnRejectPopup.addEventListener('click', rejectCall);
    backspaceButton.addEventListener('click', backspaceNumber);
    clearNumberButton.addEventListener('click', clearNumberInput); // Asociado al nuevo icono
    btnNewCall.addEventListener('click', handleNewCallAction);

    // Listeners para la tecla 'Intro' (Enter) en los campos de nÃºmero
    numberToCallInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Evitar salto de lÃ­nea en el div
            handleMainCallAction(); // Simula clic en el botÃ³n de llamar/colgar
        }
    });
    transferTarget.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            blindTransfer();
        }
    });
    attendedTransferTarget.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            attendedTransfer();
        }
    });

    // Listeners de eventos para botones de dÃ­gitos DTMF
    digitButtons.forEach(button => {
        button.addEventListener('click', () => {
            const digit = button.getAttribute('data-digit');
            // Insertar dÃ­gito en la posiciÃ³n actual del cursor si es un contenteditable
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);
            const textNode = document.createTextNode(digit);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);

            updateNumberInputState();
            // Si hay una sesiÃ³n activa y establecida, tambiÃ©n enviar DTMF
            if (currentSession && currentSession.isEstablished()) {
                sendDTMF(digit);
            }
        });
    });

    // Manejar entrada manual en numberToCallInput (el div contenteditable)
    numberToCallInput.addEventListener('input', updateNumberInputState);
    numberToCallInput.addEventListener('focus', () => {
        if (!numberToCallInput.textContent) {
            numberToCallInput.removeAttribute('placeholder');
        }
    });
    numberToCallInput.addEventListener('blur', () => {
        if (!numberToCallInput.textContent) {
            numberToCallInput.setAttribute('placeholder', 'NÃºmero o URI SIP');
        }
    });

    // Solicitar permisos de notificaciÃ³n al cargar la pÃ¡gina
    requestNotificationPermission();

    // Cargar config.json y luego inicializar y registrar
    appendToLog("Iniciando carga de configuraciÃ³n...");
    fetch('config.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(config => {
            appendToLog("ConfiguraciÃ³n cargada correctamente");
            Object.assign(sipConfig, config); // Aplicar la configuraciÃ³n
            configStatusElement.textContent = "ConfiguraciÃ³n cargada desde config.json";
            configStatusElement.style.color = "green";
            appendToLog(`Dominio SIP: ${sipConfig.sipDomain}`);
            appendToLog(`Usuario SIP: ${sipConfig.sipUser}`);
            appendToLog(`Servidor WebSocket: ${sipConfig.wsServer}`);

            initializeJsSIP(); // Inicializar JsSIP User Agent despuÃ©s de cargar la configuraciÃ³n

            if (sipConfig.autoRegister) {
                appendToLog("Iniciando registro automÃ¡tico...");
                setTimeout(() => {
                    if (ua && !ua.isRegistered()) {
                        ua.register();
                    } else if (ua && ua.isRegistered()) {
                        appendToLog("User Agent ya registrado (auto-registro).");
                        updateToggleRegisterButton(true);
                    } else {
                        appendToLog("Error: User Agent no inicializado para auto-registro.");
                    }
                }, 500); // PequeÃ±o retardo para asegurar que el UA estÃ© completamente listo
            }
        })
        .catch(error => {
            appendToLog(`Error al cargar config.json: ${error.message}`);
            configStatusElement.textContent = "Error al cargar configuraciÃ³n";
            configStatusElement.style.color = "red";
            updateCallControls(); // Asegurar que la UI estÃ© deshabilitada si la configuraciÃ³n falla
        });

    // ActualizaciÃ³n inicial de la UI
    updateNumberInputState();
    updateCallControls(); // No hay llamada, ni registro todavÃ­a
    updateToggleRegisterButton(false); // No registrado inicialmente
});

// FunciÃ³n para solicitar permisos de notificaciÃ³n
function requestNotificationPermission() {
    if (!("Notification" in window)) {
        appendToLog("Este navegador no soporta notificaciones de escritorio.");
        return;
    }

    if (Notification.permission === "granted") {
        notificationPermissionGranted = true;
        appendToLog("Permiso de notificaciÃ³n ya concedido.");
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                notificationPermissionGranted = true;
                appendToLog("Permiso de notificaciÃ³n concedido.");
            } else {
                notificationPermissionGranted = false;
                appendToLog("Permiso de notificaciÃ³n denegado.");
            }
        });
    } else {
        notificationPermissionGranted = false;
        appendToLog("Permiso de notificaciÃ³n denegado por el usuario.");
    }
}

// FunciÃ³n para mostrar una notificaciÃ³n nativa del navegador
function showNativeNotification(title, body) {
    if (notificationPermissionGranted) {
        new Notification(title, { body: body, icon: 'phone_icon.png' }); // Puedes aÃ±adir un icono personalizado
    }
}

// FunciÃ³n para actualizar el estado del input de nÃºmero y el botÃ³n de borrado
function updateNumberInputState() {
    const hasText = numberToCallInput.textContent.length > 0;
    if (hasText) {
        clearNumberButton.classList.remove('hidden');
    } else {
        clearNumberButton.classList.add('hidden');
    }
    updateCallControls(); // Esto es crucial para habilitar/deshabilitar el botÃ³n de Llamar/Colgar correctamente
}

// Funcionalidad de borrar (backspace)
function backspaceNumber() {
    const selection = window.getSelection();
    if (!selection.isCollapsed) { // Si hay texto seleccionado, bÃ³rralo
        selection.deleteFromDocument();
    } else if (numberToCallInput.textContent.length > 0) {
        // Si no hay selecciÃ³n, simula un backspace normal
        const range = selection.getRangeAt(0);
        if (range.startOffset > 0) {
            range.setStart(range.startContainer, range.startOffset - 1);
            range.deleteContents();
        } else if (range.startContainer.previousSibling) {
            // Borrar el nodo anterior si estÃ¡ al principio de un nodo (por ejemplo, si el cursor estÃ¡ antes de un BR o SPAN)
            const prevNode = range.startContainer.previousSibling;
            if (prevNode.nodeType === Node.TEXT_NODE) {
                range.setStart(prevNode, prevNode.length);
                range.deleteContents();
            } else { // Si es un elemento, eliminarlo
                prevNode.remove();
            }
        }
    }
    updateNumberInputState();
}

// Limpiar todo el texto del input de nÃºmero (para el icono 'X')
function clearNumberInput() {
    numberToCallInput.textContent = '';
    updateNumberInputState();
}

// FunciÃ³n para inicializar JsSIP User Agent
function initializeJsSIP() {
    const { wsServer, sipDomain, sipUser, sipPassword } = sipConfig;

    if (!wsServer || !sipDomain || !sipUser || !sipPassword) {
        appendToLog('Error: Faltan parÃ¡metros de configuraciÃ³n SIP para inicializar JsSIP.');
        return;
    }

    const socket = new JsSIP.WebSocketInterface(wsServer);

    const configuration = {
        sockets: [socket],
        uri: `sip:${sipUser}@${sipDomain}`,
        password: sipPassword,
        display_name: sipUser,
        register: false, // Controlamos el registro manualmente con ua.register()
        stun_servers: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302',
            'stun:stun3.l.google.com:19302',
            'stun:stun4.l.google.com:19302',
            'stun:stun.sipgate.net:10000',
            'stun:stun.ekiga.net',
            'stun:stun.ideasip.com',
            'stun:stun.voipbuster.com'
        ],
        trace_sip: true,
        log: {
            level: 'warn', // Nivel de log para reducir la verbosidad en el log (cambiar a 'debug' para mÃ¡s detalles)
            connector: (level, message) => {
                appendToLog(`[JsSIP ${level.toUpperCase()}]: ${message}`);
            }
        }
    };

    try {
        ua = new JsSIP.UA(configuration);
        appendToLog('JsSIP User Agent creado.');

        // Eventos del User Agent
        ua.on('registered', () => {
            statusElement.textContent = 'Registrado';
            statusElement.className = 'registered';
            updateToggleRegisterButton(true); // Actualizar el botÃ³n a 'Desregistrar'
            appendToLog('Evento: Registrado con Ã©xito.');
            updateCallControls(); // No hay llamada activa
        });

        ua.on('unregistered', () => {
            statusElement.textContent = 'No registrado';
            statusElement.className = 'unregistered';
            updateToggleRegisterButton(false); // Actualizar el botÃ³n a 'Registrar'
            appendToLog('Evento: Desregistrado.');
            resetAllCallStates(); // Restablece todas las llamadas y la UI
            updateCallControls();
        });

        ua.on('registration_failed', (data) => {
            statusElement.textContent = `Registro fallido: ${data.cause}`;
            statusElement.className = 'unregistered';
            appendToLog(`Evento: Registro fallido: ${data.cause}`);
            alert(`Registro fallido: ${data.cause}`);
            updateToggleRegisterButton(false); // Actualizar el botÃ³n a 'Registrar'
            updateCallControls();
        });

        ua.on('newRTCSession', (data) => {
            if (data.direction === 'incoming') {
                appendToLog(`Nueva sesiÃ³n RTCSession (incoming) de: ${data.session.remote_identity.uri.user}`);
                handleIncomingCall(data.session);
            } else { // outgoing
                appendToLog(`Nueva sesiÃ³n RTCSession (outgoing) a: ${data.session.remote_identity.uri.user}`);
                if (currentSession && !currentSession.isEnded()) {
                    // Si ya hay una llamada activa y no ha terminado, y no es la que estamos poniendo en hold
                    appendToLog(`Manejando nueva llamada saliente: Poniendo la actual (${currentSession.remote_identity.uri.user}) en espera.`);
                    if (!currentSession.isOnHold().local) {
                        currentSession.hold();
                    }
                    heldSession = currentSession;
                    currentSession = data.session; // La nueva llamada saliente es ahora la activa
                } else {
                    // No hay llamadas activas, esta es la primera saliente
                    currentSession = data.session;
                }

                setupSessionEvents(currentSession);
                callInfoElement.textContent = `Llamando a ${currentSession.remote_identity.uri.user}...`;
                updateCallControls();
            }
        });

        ua.on('connected', () => {
            appendToLog('Evento: Conectado al WebSocket.');
        });

        ua.on('disconnected', (data) => {
            appendToLog(`Evento: Desconectado del WebSocket: ${data.cause}`);
            statusElement.textContent = `Desconectado (${data.cause})`;
            statusElement.className = 'unregistered';
            updateToggleRegisterButton(false); // Actualizar el botÃ³n a 'Registrar'
            resetAllCallStates(); // Restablece todas las llamadas y la UI
            updateCallControls();
        });

        // Iniciar el User Agent
        ua.start();
        appendToLog('JsSIP User Agent iniciado.');

    } catch (error) {
        appendToLog(`Error al inicializar JsSIP User Agent: ${error.message}`);
        alert(`Error al inicializar JsSIP User Agent: ${error.message}`);
        statusElement.textContent = 'Error';
        statusElement.className = 'unregistered';
        updateCallControls();
    }
}

// FunciÃ³n para alternar el registro (Registrar/Desregistrar)
function toggleRegister() {
    if (!ua) {
        appendToLog("Error: JsSIP User Agent no inicializado. Carga el config.json primero.");
        return;
    }
    if (ua.isRegistered()) {
        appendToLog("Iniciando proceso de desregistro...");
        ua.unregister();
    } else {
        appendToLog("Iniciando proceso de registro...");
        statusElement.textContent = "Conectando...";
        statusElement.className = "status-connecting";
        ua.register();
    }
}

// Manejar el botÃ³n principal de acciÃ³n (Llamar o Colgar o Descolgar)
function handleMainCallAction() {
    if (incomingSessionCandidate) { // Si hay una llamada entrante pendiente
        answerCall();
    } else if (currentSession && !currentSession.isEnded()) {
        // Si hay una llamada en curso (establecida o saliente timbrando), colgarla
        hangup(currentSession);
    } else {
        // Si no hay llamadas, iniciar una nueva
        makeCall(numberToCallInput.textContent.trim());
    }
}

// Maneja el botÃ³n "Nueva Llamada"
async function handleNewCallAction() {
    if (!ua || !ua.isRegistered()) {
        alert('Debes registrarte primero para iniciar una nueva llamada.');
        return;
    }

    if (incomingSessionCandidate) {
        alert('Ya hay una llamada entrante. RespÃ³ndela o rechÃ¡zala primero.');
        return;
    }

    if (currentSession && currentSession.isEstablished() && !heldSession) {
        appendToLog("Manejando Nueva Llamada: Poniendo la actual en espera...");
        try {
            await currentSession.hold();
            heldSession = currentSession;
            currentSession = null; // Limpiar currentSession para la nueva llamada
            isHeld = true; // El estado de hold se aplica a la heldSession, no a la "current"
            appendToLog("Llamada actual puesta en espera. Marcador listo para nueva llamada.");
            numberToCallInput.textContent = '';
            updateNumberInputState();
            updateCallControls();
        } catch (error) {
            appendToLog(`Error al poner la llamada en espera para nueva llamada: ${error.message}`);
            alert(`Error al iniciar nueva llamada: ${error.message}`);
        }
    } else if (heldSession && !currentSession) {
        appendToLog("Ya hay una llamada en espera. Inicia la nueva llamada.");
        numberToCallInput.textContent = '';
        updateNumberInputState();
    } else if (currentSession && currentSession.isEstablishing()) {
         alert('Ya hay una llamada en proceso (timbrando/conectando). Espera a que se establezca o cuelga para iniciar otra.');
         appendToLog('Intento de nueva llamada con sesiÃ³n en proceso. OperaciÃ³n no permitida.');
    } else if (currentSession && heldSession) {
         alert('Ya hay una llamada activa y una en espera. No se pueden gestionar mÃ¡s llamadas simultÃ¡neamente.');
         appendToLog('Intento de nueva llamada con dos sesiones activas/en espera. OperaciÃ³n no permitida.');
    } else {
        appendToLog('No hay llamadas en curso, simplemente usa el botÃ³n de "Llamar".');
        numberToCallInput.textContent = '';
        updateNumberInputState();
    }
}


// FunciÃ³n para realizar una llamada (usada tanto para la primera como para la de consulta)
async function makeCall(targetNumber) {
    if (!ua || !ua.isRegistered()) {
        alert('Debes registrarte primero.');
        appendToLog('Error: Intento de llamada sin registrar.');
        return;
    }

    const number = targetNumber;
    if (!number) {
        alert('Ingresa un nÃºmero o URI SIP para llamar.');
        appendToLog('Error: NÃºmero de destino vacÃ­o.');
        return;
    }

    try {
        // Obtener acceso al micrÃ³fono si no lo tenemos ya
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            appendToLog('Acceso al micrÃ³fono obtenido.');
        }

        const options = {
            mediaConstraints: { audio: true, video: false },
            pcHeaders: {
                'X-From-Custom-Header': 'JsSIP-Webphone'
            },
            rtcOfferConstraints: {
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            },
            mediaStream: localStream
        };

        let targetURI;
        if (number.includes('@')) {
            targetURI = number;
        } else {
            targetURI = `sip:${number}@${sipConfig.sipDomain}`;
        }

        appendToLog(`Intentando llamar a: ${targetURI}`);
        ua.call(targetURI, options);
        numberToCallInput.textContent = ''; // Limpiar el campo del marcador
        updateNumberInputState();
    } catch (error) {
        appendToLog(`Error al iniciar llamada: ${error.message}`);
        alert(`Error al iniciar llamada: ${error.message}`);
        // Si falla la llamada saliente, asegurarnos de limpiar el estado
        resetAllCallStates(); // Esto podrÃ­a ser demasiado agresivo, quizÃ¡s solo limpiar currentSession
    }
}

// Manejar llamada entrante
function handleIncomingCall(session) {
    // Si ya hay una llamada entrante pendiente, rechazar la nueva
    if (incomingSessionCandidate) {
        appendToLog(`Llamada entrante de ${session.remote_identity.uri.user} rechazada: otra llamada entrante pendiente.`);
        session.terminate({
            'status_code': 486, // Ocupado
            'reason_phrase': 'Busy Here'
        });
        return;
    }

    // Si hay una llamada activa (establecida o saliente timbrando), ponerla en espera si es posible
    if (currentSession && !currentSession.isEnded()) {
        if (currentSession.isEstablishing() || currentSession.isRinging()) {
            appendToLog(`Llamada entrante de ${session.remote_identity.uri.user} rechazada: lÃ­nea ocupada con llamada saliente/timbrando.`);
            session.terminate({
                'status_code': 486,
                'reason_phrase': 'Busy Here'
            });
            return;
        }
        // Si la llamada actual estÃ¡ establecida, la ponemos en hold y la movemos a heldSession
        if (currentSession.isEstablished()) {
            appendToLog(`Llamada actual (${currentSession.remote_identity.uri.user}) puesta en espera para atender nueva llamada entrante.`);
            currentSession.hold();
            heldSession = currentSession;
            currentSession = null; // Ahora no hay currentSession activa
        }
    }

    incomingSessionCandidate = session; // Almacenar la sesiÃ³n entrante en esta nueva variable
    setupSessionEvents(incomingSessionCandidate); // Configurar eventos para la sesiÃ³n entrante
    showIncomingCallPopup(incomingSessionCandidate);
    showNativeNotification("Llamada Entrante", `De: ${session.remote_identity.uri.user}`); // NotificaciÃ³n nativa
    updateCallControls(); // Actualizar la UI para mostrar los botones de "Descolgar" / "Colgar"
    callInfoElement.textContent = `Llamada entrante de: ${incomingSessionCandidate.remote_identity.uri.user}`; // Mostrar nÃºmero del llamante
}

function showIncomingCallPopup(session) {
    const caller = session.remote_identity.uri.user;
    incomingCallInfo.textContent = `Llamada entrante de: ${caller}`;
    incomingCallPopup.style.display = 'block';
}


// Responder a una llamada entrante
async function answerCall() {
    if (!incomingSessionCandidate || !incomingSessionCandidate.isRinging()) {
        appendToLog('No hay llamada entrante para responder o no estÃ¡ en estado RINGING.');
        return;
    }

    try {
        // Si ya tenemos el stream local (por una llamada anterior o auto-registro), no pedirlo de nuevo
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            appendToLog('Acceso al micrÃ³fono obtenido para contestar.');
        }

        const options = {
            mediaConstraints: { audio: true, video: false },
            rtcOfferConstraints: {
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            },
            mediaStream: localStream
        };

        await incomingSessionCandidate.answer(options);
        appendToLog('Llamada contestada.');
        currentSession = incomingSessionCandidate; // La sesiÃ³n entrante ahora es la activa
        incomingSessionCandidate = null; // Limpiar la variable de sesiÃ³n entrante
        incomingCallPopup.style.display = 'none'; // Ocultar popup
        updateCallControls();
        callInfoElement.textContent = `En llamada con ${currentSession.remote_identity.uri.user}`;
    } catch (error) {
        appendToLog(`Error al contestar llamada: ${error.message}`);
        alert(`Error al contestar llamada: ${error.message}`);
        if (incomingSessionCandidate && !incomingSessionCandidate.isEnded()) {
             incomingSessionCandidate.terminate(); // Terminar si hay error
        }
        resetAllCallStates();
    }
}

// Rechazar una llamada entrante
function rejectCall() {
    if (incomingSessionCandidate && incomingSessionCandidate.isRinging()) {
        incomingSessionCandidate.terminate({
            'status_code': 486, // Ocupado
            'reason_phrase': 'Busy Here'
        });
        appendToLog('Llamada rechazada.');
        incomingCallPopup.style.display = 'none'; // Ocultar popup
        incomingSessionCandidate = null; // Limpiar la variable de sesiÃ³n entrante

        // Si habÃ­a una llamada en espera, reanudarla
        if (heldSession && !heldSession.isEnded()) {
            currentSession = heldSession; // La llamada en espera se convierte en la activa
            heldSession = null;
            currentSession.unhold()
                .then(() => {
                    appendToLog("Llamada entrante rechazada. Volviendo a la llamada anterior.");
                    updateCallControls();
                })
                .catch(error => {
                    appendToLog(`Error al reanudar llamada en espera despuÃ©s de rechazar entrante: ${error.message}`);
                    resetAllCallStates();
                });
        } else {
            resetAllCallStates(); // Si no habÃ­a nada en espera, limpiar todo
        }
    } else {
        appendToLog('No hay llamada entrante para rechazar o no estÃ¡ en estado RINGING.');
    }
}

// Configurar eventos de sesiÃ³n
function setupSessionEvents(session) {
    session.on('peerconnection', (data) => {
        appendToLog('Evento: PeerConnection creado.');
        const pc = data.peerconnection;

        pc.addEventListener('track', (event) => {
            appendToLog(`Evento: Pista remota recibida (${event.track.kind}).`);
            if (event.track.kind === 'audio') {
                const newRemoteStream = new MediaStream([event.track]);
                remoteAudio.srcObject = newRemoteStream;
                remoteAudio.play();
                appendToLog('Reproduciendo audio remoto.');
            }
        });

        pc.addEventListener('addstream', (event) => { // Para compatibilidad
            appendToLog('Evento: addstream (MÃ©todo antiguo) - Stream remoto recibido.');
            if (event.stream.getAudioTracks().length > 0) {
                remoteAudio.srcObject = event.stream;
                remoteAudio.play();
                appendToLog('Reproduciendo audio remoto (via addstream).');
            }
        });
    });

    session.on('connecting', () => {
        appendToLog('Evento: SesiÃ³n conectando...');
        if (session === currentSession) {
            callInfoElement.textContent = 'Conectando...';
        }
        updateCallControls();
    });

    session.on('progress', (data) => {
        appendToLog(`Evento: Llamada en progreso (timbrando). Origen: ${data.originator}`);
        if (session === currentSession) {
            callInfoElement.textContent = `Timbrando a ${session.remote_identity.uri.user}...`;
        } else if (session === incomingSessionCandidate) {
            callInfoElement.textContent = `Llamada entrante de: ${session.remote_identity.uri.user}`;
        }
        updateCallControls();
    });

    session.on('started', () => {
        appendToLog('Evento: Llamada establecida.');
        // Nos aseguramos que la sesiÃ³n que acaba de iniciar sea la currentSession
        if (incomingSessionCandidate === session) { // Si una entrante es establecida
            currentSession = incomingSessionCandidate;
            incomingSessionCandidate = null;
            incomingCallPopup.style.display = 'none'; // Ocultar popup
        }
        callInfoElement.textContent = `En llamada con ${session.remote_identity.uri.user}`;
        updateCallControls();
    });

    session.on('failed', (data) => {
        appendToLog(`Evento: Llamada fallida: ${data.cause}`);
        alert(`Llamada fallida: ${data.cause}`);
        handleSessionEnd(session); // Llama a la funciÃ³n de manejo de finalizaciÃ³n
    });

    session.on('ended', (data) => {
        appendToLog(`Evento: Llamada finalizada: ${data.cause}`);
        handleSessionEnd(session); // Llama a la funciÃ³n de manejo de finalizaciÃ³n
    });

    session.on('hold', (data) => {
        if (session === currentSession) {
            isHeld = true;
            btnHold.innerHTML = '<i class="fa-solid fa-play"></i> Reanudar'; // Icono de play
            callInfoElement.textContent += ' (En espera)';
        } else if (session === heldSession) {
            // Si la sesiÃ³n que entrÃ³ en hold es la heldSession
            appendToLog(`La sesiÃ³n en espera (${heldSession.remote_identity.uri.user}) ha sido puesta en hold.`);
        }
        appendToLog(`Evento: Llamada en espera (${data.originator === 'local' ? 'local' : 'remoto'}): ${session.remote_identity.uri.user}`);
        updateCallControls();
    });

    session.on('unhold', (data) => {
        if (session === currentSession) {
            isHeld = false;
            btnHold.innerHTML = '<i class="fa-solid fa-pause"></i> En espera'; // Icono de pausa
            callInfoElement.textContent = callInfoElement.textContent.replace(' (En espera)', '');
        } else if (session === heldSession) {
            // Si la sesiÃ³n que se quitÃ³ del hold es la heldSession
            appendToLog(`La sesiÃ³n en espera (${heldSession.remote_identity.uri.user}) ha sido reanudada.`);
        }
        appendToLog(`Evento: Llamada reanudada (${data.originator === 'local' ? 'local' : 'remoto'}): ${session.remote_identity.uri.user}`);
        updateCallControls();
    });

    session.on('muted', (data) => {
        if (session === currentSession && data.audio) {
            isMuted = true;
            btnMute.innerHTML = '<i class="fa-solid fa-microphone"></i> Activar'; // Icono de micrÃ³fono
            appendToLog('Evento: MicrÃ³fono silenciado (local).');
        }
    });

    session.on('unmuted', (data) => {
        if (session === currentSession && data.audio) {
            isMuted = false;
            btnMute.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Silenciar'; // Icono de micrÃ³fono silenciado
            appendToLog('Evento: MicrÃ³fono activado (local).');
        }
    });

    session.on('refer', (data) => {
        appendToLog(`Evento: Solicitud de REFER recibida. Transferencia a: ${data.request.getHeader('Refer-To')}`);
        // En un escenario real, aquÃ­ se podrÃ­a manejar una transferencia ciega entrante
        // o notificar al usuario sobre una transferencia iniciada por el otro extremo.
        // Para este softphone, asumimos que REFER es manejado internamente para transferencia atendida.
    });
}

// Manejo general para cuando una sesiÃ³n termina (fallida o finalizada)
function handleSessionEnd(session) {
    if (session === currentSession) {
        currentSession = null;
        isMuted = false;
        isHeld = false;
        btnMute.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Silenciar';
        btnHold.innerHTML = '<i class="fa-solid fa-pause"></i> En espera';
        callInfoElement.textContent = '';
        remoteAudio.srcObject = null; // Detener la reproducciÃ³n del audio remoto

        // Si habÃ­a una llamada en espera, activarla
        if (heldSession && !heldSession.isEnded()) {
            currentSession = heldSession;
            heldSession = null;
            currentSession.unhold()
                .then(() => {
                    appendToLog(`Volviendo a la llamada anterior con ${currentSession.remote_identity.uri.user}.`);
                    callInfoElement.textContent = `En llamada con ${currentSession.remote_identity.uri.user}`;
                    updateCallControls();
                })
                .catch(error => {
                    appendToLog(`Error al reanudar llamada en espera despuÃ©s de colgar la activa: ${error.message}`);
                    resetAllCallStates(); // Fallback si no se puede reanudar
                });
        } else {
            // Si no hay mÃ¡s llamadas, resetear todo
            resetAllCallStates();
        }
    } else if (session === heldSession) {
        heldSession = null;
        appendToLog(`La llamada en espera con ${session.remote_identity.uri.user} ha terminado.`);
        updateCallControls(); // Actualizar UI por si la llamada activa sigue
    } else if (session === incomingSessionCandidate) {
         // Si la llamada entrante pendiente termina, limpiar tambiÃ©n
         incomingSessionCandidate = null;
         incomingCallPopup.style.display = 'none';
         appendToLog(`La llamada entrante de ${session.remote_identity.uri.user} ha terminado antes de ser respondida.`);
         // Si habÃ­a una llamada en hold, reanudarla.
         if (heldSession && !heldSession.isEnded()) {
            currentSession = heldSession;
            heldSession = null;
            currentSession.unhold()
                .then(() => {
                    appendToLog(`Volviendo a la llamada anterior con ${currentSession.remote_identity.uri.user} (despuÃ©s de que la entrante se colgara).`);
                    callInfoElement.textContent = `En llamada con ${currentSession.remote_identity.uri.user}`;
                    updateCallControls();
                })
                .catch(error => {
                    appendToLog(`Error al reanudar llamada en espera despuÃ©s de que la entrante se colgara: ${error.message}`);
                    resetAllCallStates();
                });
        } else {
            updateCallControls(); // Si no hay mÃ¡s llamadas, solo actualizar la UI
            callInfoElement.textContent = ''; // Limpiar si no queda ninguna llamada
        }
    }
}

// Colgar una sesiÃ³n especÃ­fica (o la activa si no se especifica)
function hangup(sessionToHangup) {
    if (sessionToHangup && !sessionToHangup.isEnded()) {
        appendToLog(`Finalizando llamada con ${sessionToHangup.remote_identity.uri.user}...`);
        sessionToHangup.terminate();
    } else {
        appendToLog('No hay llamada activa para colgar o ya ha terminado.');
    }
}

// Silenciar/activar micrÃ³fono de la sesiÃ³n activa
function toggleMute() {
    if (!currentSession || !currentSession.isEstablished()) return;

    if (!isMuted) {
        currentSession.mute({ audio: true });
        appendToLog('Silenciando micrÃ³fono de la llamada activa.');
    } else {
        currentSession.unmute({ audio: true });
        appendToLog('Activando micrÃ³fono de la llamada activa.');
    }
}

// Poner/quitar llamada activa en espera
async function toggleHold() {
    if (!currentSession || !currentSession.isEstablished()) return;

    try {
        if (!isHeld) {
            await currentSession.hold();
            appendToLog('Poniendo llamada activa en espera.');
        } else {
            await currentSession.unhold();
            appendToLog('Reanudando llamada activa.');
        }
    } catch (error) {
        appendToLog(`Error al cambiar estado de espera de la llamada activa: ${error.message}`);
        alert(`Error al cambiar estado de espera: ${error.message}`);
    }
}

// Transferencia directa (ciega)
function blindTransfer() {
    if (!currentSession || !currentSession.isEstablished()) {
        alert('No hay llamada activa para transferir.');
        return;
    }

    const target = transferTarget.value.trim();
    if (!target) {
        alert('Introduce el destino de la transferencia ciega.');
        return;
    }

    try {
        let targetURI;
        if (target.includes('@')) {
            targetURI = target;
        } else {
            targetURI = `sip:${target}@${sipConfig.sipDomain}`;
        }
        currentSession.refer(targetURI);
        appendToLog(`Transferencia ciega a ${target} iniciada.`);
        transferTarget.value = ''; // Limpiar campo despuÃ©s de usar
        // DespuÃ©s de una transferencia ciega, la sesiÃ³n actual generalmente se termina
        // La sesiÃ³n actual se deberÃ­a terminar automÃ¡ticamente al recibir la respuesta al REFER,
        // pero si el comportamiento no es consistente, se puede aÃ±adir un hangup aquÃ­.
        // Sin embargo, es mejor dejar que JsSIP maneje el fin de la sesiÃ³n por el evento 'ended'.
    } catch (error) {
        appendToLog(`Error al realizar transferencia ciega: ${error.message}`);
        alert(`Error al realizar transferencia ciega: ${error.message}`);
    }
}

// Transferencia atendida (consultiva)
async function attendedTransfer() {
    if (!currentSession || !currentSession.isEstablished()) {
        alert('No hay llamada activa para transferir.');
        return;
    }

    const target = attendedTransferTarget.value.trim();
    if (!target) {
        alert('Introduce el destino de la consulta para transferencia atendida.');
        return;
    }

    if (heldSession) {
        alert('Ya hay una llamada en espera. No se puede iniciar otra transferencia atendida en este momento.');
        return;
    }

    let consultationSession;

    try {
        // 1. Poner la llamada actual en espera
        if (!isHeld) { // Solo si no estÃ¡ ya en espera
            await currentSession.hold();
            appendToLog('Llamada actual puesta en espera para transferencia atendida.');
        }
        heldSession = currentSession; // Mover la llamada original a heldSession
        currentSession = null; // Limpiar currentSession para la nueva llamada de consulta

        // 2. Iniciar una nueva llamada de consulta
        appendToLog(`Iniciando llamada de consulta a ${target}...`);

        // Obtener acceso al micrÃ³fono si no lo tenemos ya (para la nueva llamada de consulta)
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            appendToLog('Acceso al micrÃ³fono obtenido para consulta.');
        }

        const options = {
            mediaConstraints: { audio: true, video: false },
            rtcOfferConstraints: {
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            },
            mediaStream: localStream
        };

        let targetURI;
        if (target.includes('@')) {
            targetURI = target;
        } else {
            targetURI = `sip:${target}@${sipConfig.sipDomain}`;
        }

        consultationSession = ua.call(targetURI, options);

        // Configurar eventos para la sesiÃ³n de consulta
        setupSessionEvents(consultationSession);
        currentSession = consultationSession; // La sesiÃ³n de consulta es ahora la activa
        attendedTransferTarget.value = ''; // Limpiar el campo del input
        updateCallControls();

        // Esperar a que la llamada de consulta se establezca
        // (Se usa un listener on.started en vez de un await directo para JsSIP)
        consultationSession.on('started', async () => {
            appendToLog(`Consulta con ${target} establecida. Esperando acciÃ³n del usuario.`);
            const confirmTransfer = confirm(`Consulta con ${target} establecida. Â¿Desea completar la transferencia (consultado a la original)?`);

            if (confirmTransfer) {
                try {
                    if (currentSession && heldSession) {
                        appendToLog(`Realizando REFER entre ${heldSession.remote_identity.uri.user} (original) y ${currentSession.remote_identity.uri.user} (consultada)...`);
                        await heldSession.refer(currentSession);

                        appendToLog(`Transferencia atendida completada con Ã©xito.`);
                        // Ambas sesiones deberÃ­an terminar despuÃ©s de un REFER exitoso.
                        // JsSIP deberÃ­a emitir 'ended' para ambas.
                    } else {
                        appendToLog('Error: No se pudo completar la transferencia. Faltan sesiones.');
                        alert('No se pudo completar la transferencia: Faltan sesiones.');
                        // Asegurarse de terminar las sesiones si no se pudo transferir
                        if (heldSession && !heldSession.isEnded()) { heldSession.terminate(); }
                        if (currentSession && !currentSession.isEnded()) { currentSession.terminate(); }
                        resetAllCallStates();
                    }
                } catch (transferError) {
                    appendToLog(`Error al completar la transferencia atendida: ${transferError.message}`);
                    alert(`Error al completar la transferencia atendida: ${transferError.message}`);
                    // Si falla la transferencia, intentar reanudar la llamada original y terminar la de consulta
                    if (heldSession && !heldSession.isEnded()) {
                        await heldSession.unhold();
                        currentSession = heldSession;
                        heldSession = null;
                        updateCallControls();
                    }
                    if (consultationSession && !consultationSession.isEnded()) {
                        await consultationSession.terminate();
                    }
                }
            } else {
                appendToLog('Transferencia atendida cancelada por el usuario.');
                // Terminar la llamada de consulta y reanudar la original
                if (consultationSession && !consultationSession.isEnded()) {
                    await consultationSession.terminate();
                }
                if (heldSession && !heldSession.isEnded()) {
                    await heldSession.unhold();
                    currentSession = heldSession;
                    heldSession = null;
                    updateCallControls();
                } else {
                    resetAllCallStates();
                }
            }
        });

        consultationSession.on('failed', (data) => {
            appendToLog(`Evento: Llamada de consulta fallida: ${data.cause}`);
            alert(`Llamada de consulta fallida: ${data.cause}`);
            // Si la consulta falla, reanudar la llamada original
            if (heldSession && !heldSession.isEnded()) {
                heldSession.unhold();
                currentSession = heldSession;
                heldSession = null;
                updateCallControls();
            } else {
                resetAllCallStates();
            }
        });

        consultationSession.on('ended', (data) => {
            appendToLog(`Evento: Llamada de consulta finalizada: ${data.cause}`);
            // Si la llamada de consulta termina, y no hay una transferencia exitosa,
            // y la heldSession sigue existiendo, reanudarla.
            if (heldSession && !heldSession.isEnded() && currentSession !== heldSession) {
                currentSession = heldSession; // La heldSession pasa a ser la activa
                heldSession = null;
                currentSession.unhold().then(() => {
                    appendToLog('Volviendo a la llamada original despuÃ©s de que la consulta terminara.');
                    updateCallControls();
                });
            } else if (!currentSession && !heldSession && !incomingSessionCandidate) {
                resetAllCallStates();
            }
        });

    } catch (error) {
        appendToLog(`Error al iniciar el proceso de transferencia atendida: ${error.message}`);
        alert(`Error al iniciar el proceso de transferencia atendida: ${error.message}`);
        // En caso de error, intentar reanudar la llamada original si estaba en espera
        if (heldSession && !heldSession.isEnded()) {
            heldSession.unhold();
            currentSession = heldSession;
            heldSession = null;
            updateCallControls();
        } else {
            resetAllCallStates();
        }
    }
}

// Enviar DTMF
function sendDTMF(digit) {
    if (currentSession && currentSession.isEstablished()) {
        try {
            currentSession.sendDTMF(digit, {
                duration: 500, // DuraciÃ³n del tono en ms
                interToneGap: 50 // Pausa entre tonos en ms
            });
            appendToLog(`DTMF enviado a la llamada activa: ${digit}`);
        } catch (error) {
            appendToLog(`Error al enviar DTMF: ${error.message}`);
        }
    } else {
        appendToLog('No hay llamada activa para enviar DTMF.');
    }
}

// AÃ±adir mensaje al log
function appendToLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${timestamp}] ${message}`;
    eventLogElement.appendChild(logEntry);
    eventLogElement.scrollTop = eventLogElement.scrollHeight;
    console.log(`[${timestamp}] ${message}`);
}

// Resetea *todas* las variables y el estado de la UI
function resetAllCallStates() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (remoteAudio) {
        remoteAudio.srcObject = null;
    }
    // Terminar cualquier sesiÃ³n que pueda seguir activa o en espera
    if (currentSession && !currentSession.isEnded()) {
         appendToLog(`Terminando currentSession: ${currentSession.remote_identity.uri.user}`);
         currentSession.terminate();
    }
    if (heldSession && !heldSession.isEnded()) {
        appendToLog(`Terminando heldSession: ${heldSession.remote_identity.uri.user}`);
        heldSession.terminate();
    }
    if (incomingSessionCandidate && !incomingSessionCandidate.isEnded()) {
        appendToLog(`Terminando incomingSessionCandidate: ${incomingSessionCandidate.remote_identity.uri.user}`);
        incomingSessionCandidate.terminate();
    }


    currentSession = null;
    heldSession = null;
    incomingSessionCandidate = null;
    isMuted = false;
    isHeld = false;
    btnMute.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Silenciar';
    btnHold.innerHTML = '<i class="fa-solid fa-pause"></i> En espera';
    callInfoElement.textContent = '';
    incomingCallPopup.style.display = 'none'; // Asegurarse de que el popup estÃ© oculto
    numberToCallInput.textContent = '';
    transferTarget.value = '';
    attendedTransferTarget.value = '';
    updateNumberInputState();
    updateCallControls(); // Esto es importante para actualizar el botÃ³n principal y la visibilidad de los controles
}

// Actualiza el estado del botÃ³n de registro/desregistro
function updateToggleRegisterButton(isRegistered) {
    if (isRegistered) {
        btnToggleRegister.textContent = 'Desregistrar';
        btnToggleRegister.className = 'red';
    } else {
        btnToggleRegister.textContent = 'Registrar';
        btnToggleRegister.className = 'green';
    }
}

// Actualiza el estado de los botones de control de llamada
function updateCallControls() {
    const isRegistered = ua && ua.isRegistered();
    const hasNumberInMainDialer = numberToCallInput.textContent.length > 0;
    const hasTransferTarget = transferTarget.value.length > 0;
    const hasAttendedTransferTarget = attendedTransferTarget.value.length > 0;

    // LÃ³gica para el botÃ³n principal de Llamar/Colgar/Descolgar
    if (incomingSessionCandidate) {
        // Hay una llamada entrante pendiente
        mainCallActionButton.innerHTML = '<i class="fa-solid fa-phone"></i> Descolgar';
        mainCallActionButton.className = 'green';
        mainCallActionButton.disabled = false;
        callInfoElement.textContent = `Llamada entrante de: ${incomingSessionCandidate.remote_identity.uri.user}`;
    } else if (currentSession && !currentSession.isEnded()) {
        // Si hay una llamada en curso (establecida o saliente timbrando)
        mainCallActionButton.innerHTML = '<i class="fa-solid fa-phone-slash"></i> Colgar';
        mainCallActionButton.className = 'red';
        mainCallActionButton.disabled = false;
        // El callInfoElement se actualiza en los eventos de la sesiÃ³n (connecting, progress, started)
    } else {
        // No hay llamadas activas
        mainCallActionButton.innerHTML = '<i class="fa-solid fa-phone"></i> Llamar';
        mainCallActionButton.className = 'green';
        mainCallActionButton.disabled = !isRegistered || !hasNumberInMainDialer;
        callInfoElement.textContent = ''; // Limpiar si no hay llamadas
    }

    // Visibilidad y estado del botÃ³n "Nueva Llamada"
    btnNewCall.disabled = !isRegistered || !currentSession || !currentSession.isEstablished() || heldSession || incomingSessionCandidate;

    // Controles especÃ­ficos de la llamada en curso (silenciar, en espera)
    if (currentSession && currentSession.isEstablished() && !incomingSessionCandidate) {
        inCallControls.classList.remove('hidden');
        btnMute.disabled = false;
        btnHold.disabled = false;
    } else {
        inCallControls.classList.add('hidden');
        btnMute.disabled = true;
        btnHold.disabled = true;
    }

    // Controles de transferencia (ciega y atendida)
    // Se muestran solo si hay una currentSession establecida y no hay heldSession o incoming pendiente
    if (currentSession && currentSession.isEstablished() && !heldSession && !incomingSessionCandidate) {
        transferControls.classList.remove('hidden');
        transferTarget.disabled = false;
        attendedTransferTarget.disabled = false;

        btnTransfer.disabled = !hasTransferTarget;
        btnAttendedTransfer.disabled = !hasAttendedTransferTarget;
    } else {
        transferControls.classList.add('hidden');
        transferTarget.disabled = true;
        transferTarget.value = '';
        attendedTransferTarget.disabled = true;
        attendedTransferTarget.value = '';
        btnTransfer.disabled = true;
        btnAttendedTransfer.disabled = true;
    }

    updateToggleRegisterButton(isRegistered);
}
