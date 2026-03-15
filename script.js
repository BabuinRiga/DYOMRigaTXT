const win1251Decoder = new TextDecoder('windows-1251');
const win1251Bytes = new Uint8Array(256);
for (let i = 0; i < 256; i++) win1251Bytes[i] = i;
const win1251Chars = win1251Decoder.decode(win1251Bytes);

// --------------------------------------------------------------------------- Управление файлами

let currentFile = null
let files = []

async function openFile(file) {
    try {
        const missionData = await parseDYOM(file)

        const fileID = crypto.randomUUID()
        files.push({
            id: fileID,
            data: missionData,
            dataOld: missionData,
            currentObjIndex: -1,
            currentScroll: 0
        });

        await createTab(missionData.name, fileID)
        await openTab(fileID)
    } catch (err) {
        console.error("Ошибка при открытии файла:", err)
    }
}

async function closeFile(id) {
    const index = files.findIndex(f => f.id === id)
    if (index !== -1) {
        files.splice(index, 1)
        const tab = tabs.querySelector(`.tab[data-id="${id}"]`)
        if (tab) tab.remove()
    }
    const remainFile = files.findLast(f => f.id !== id)
    if (remainFile) {
        openTab(remainFile.id)
    } else {
        currentFile = null
        document.getElementById("editor").style.display = "none"
        document.getElementById("topbarObjMenu").style.display = "none";
        loadFilePanel.classList.remove("hidden");
        loadFilePanel.classList.remove("overlay");
    }
}

// --------------------------------------------------------------------------- DYOM

async function parseDYOM(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    let offset = 0;
    const decoder = new TextDecoder('windows-1251');

    function readNTString() {
        let start = offset;
        while (offset < buffer.byteLength && view.getUint8(offset) !== 0) offset++;
        const strBytes = new Uint8Array(buffer, start, offset - start);
        offset++;
        return decoder.decode(strBytes).trim();
    }

    const readI32 = () => {
        const v = view.getInt32(offset, true);
        offset += 4;
        return v;
    };
    const skipBytes = (bytes) => { offset += bytes; };
    const readI32Array = (count) => {
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(readI32());
        return arr;
    };

    try {
        const version = readI32();
        const name = readNTString();
        const author = readNTString();
        const intro1 = readNTString();
        const intro2 = readNTString();
        const intro3 = readNTString();
        const audioCode = readNTString();

        const slice2Start = offset; // Первій бинарний кусок

        const objectiveCount = readI32();
        const actorCount = readI32();
        const carCount = readI32();
        const pickupCount = readI32();
        const objectCount = readI32();

        skipBytes((6 * 4) + (9 * 4));

        skipBytes(400 * 5);
        const objectiveTypes = readI32Array(100);
        skipBytes(400 * 10);

        const slice3Start = offset; // Второй бинарный кусок

        const allObjctvTXT = [];
        for (let i = 0; i < 100; i++) {
            allObjctvTXT.push(readNTString());
        }

        const slice4Start = offset; // Третий бинарный кусок

        const objectives = [];
        for (let i = 0; i < objectiveCount; i++) {
            objectives.push({
                type: objectiveTypes[i],
                text: allObjctvTXT[i]
            });
        }

        return {
            version, name, author, audioCode,
            intros: [intro1, intro2, intro3],
            objectivesCount: objectiveCount,
            objectives,
            memory: {
                allObjctvTXT,
                slcPart2: buffer.slice(slice2Start, slice3Start),
                slcPart4: buffer.slice(slice4Start)
            }
        };
    } catch (e) {
        console.error("Ошибка на оффсете:", offset, e);
        return null;
    }
}

async function saveDYOM(id) {
    const file = files.find(f => f.id === id);
    if (!file) return;

    const data = file.data;

    function encodeNTString(text) {
        text = text || "";
        const arr = new Uint8Array(text.length + 1);
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const byte = win1251Chars.indexOf(char);
            
            arr[i] = byte !== -1 ? byte : char.charCodeAt(0);
        }
        arr[text.length] = 0; // Null terminated
        return arr;
    }

    const parts = [];

    const versionBuf = new Uint8Array(4);
    new DataView(versionBuf.buffer).setInt32(0, data.version, true);
    parts.push(versionBuf);

    parts.push(encodeNTString(data.name));
    parts.push(encodeNTString(data.author));
    parts.push(encodeNTString(data.intros[0]));
    parts.push(encodeNTString(data.intros[1]));
    parts.push(encodeNTString(data.intros[2]));
    parts.push(encodeNTString(data.audioCode));

    parts.push(new Uint8Array(data.memory.slcPart2));

    for (let i = 0; i < 100; i++) {
        parts.push(encodeNTString(data.memory.allObjctvTXT[i]));
    }

    parts.push(new Uint8Array(data.memory.slcPart4));

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const resultBuffer = new Uint8Array(totalLength);
    let currentOffset = 0;
    for (const p of parts) {
        resultBuffer.set(p, currentOffset);
        currentOffset += p.byteLength;
    }

    const blob = new Blob([resultBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "DYOM0.dat";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --------------------------------------------------------------------------- Редактор

async function createTab(name, id) {
    const tab = document.createElement("div")
    tab.className = "tab"
    tab.draggable = true

    tab.innerHTML = `
        <div class="tabText">
            <span class="tabTitle">${sourceTextToRU(name)}</span>
        </div>
        <button class="tabClose">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.4 19L5 17.6L10.6 12L5 6.4L6.4 5L12 10.6L17.6 5L19 6.4L13.4 12L19 17.6L17.6 19L12 13.4L6.4 19Z"/>
            </svg>
        </button>
    `

    tabs.appendChild(tab)

    tab.dataset.id = id

    tab.onclick = () => {
        openTab(id)
    }
    tab.querySelector(".tabClose").onclick = async (e) => {
        e.stopPropagation()
        await closeFile(id)
    }

    initTabDrag(tab)
}

function openTab(id) {
    const oldTab = tabs.querySelector(`.tab[data-id="${currentFile}"]`)
    const tab = tabs.querySelector(`.tab[data-id="${id}"]`)

    if (oldTab) oldTab.classList.remove("active")
    tab.classList.add("active")

    currentFile = id
    renderEditor()
}

function getObjectiveInfo(type) {
    switch (type) {
        case 0: return { name: "Игрок", icon: `<img class="objIcon" src="data/OBJ0.svg" alt="0">`, isEditable: false };
        case 1: return { name: "Машина", icon: `<img class="objIcon" src="data/OBJ1.svg" alt="1">`, isEditable: true };
        case 2: return { name: "Маркер", icon: `<img class="objIcon" src="data/OBJ2.svg" alt="2">`, isEditable: true };
        case 3: return { name: "Пикап", icon: `<img class="objIcon" src="data/OBJ3.svg" alt="3">`, isEditable: true };
        case 4: return { name: "Чекпоинт", icon: `<img class="objIcon" src="data/OBJ4.svg" alt="4">`, isEditable: true };
        case 5: return { name: "Актер", icon: `<img class="objIcon" src="data/OBJ5.svg" alt="5">`, isEditable: true };
        case 6: return { name: "Катсцена", icon: `<img class="objIcon" src="data/OBJ6.svg" alt="6">`, isEditable: true };
        case 7: return { name: "Телепорт", icon: `<img class="objIcon" src="data/OBJ7.svg" alt="7">`, isEditable: false };
        case 8: return { name: "Обратный отсчет", icon: `<img class="objIcon" src="data/OBJ8.svg" alt="8">`, isEditable: false };
        case 9: return { name: "Телепорт в машину", icon: `<img class="objIcon" src="data/OBJ9.svg" alt="9">`, isEditable: true };
        case 10: return { name: "Таймаут", icon: `<img class="objIcon" src="data/OBJ10.svg" alt="10">`, isEditable: true };
        case 11: return { name: "Погода", icon: `<img class="objIcon" src="data/OBJ11.svg" alt="11">`, isEditable: false };
        case 12: return { name: "Время", icon: `<img class="objIcon" src="data/OBJ12.svg" alt="12">`, isEditable: false };
        case 13: return { name: "Траффик", icon: `<img class="objIcon" src="data/OBJ13.svg" alt="13">`, isEditable: false };
        case 14: return { name: "Уровень розыска", icon: `<img class="objIcon" src="data/OBJ14.svg" alt="14">`, isEditable: false };
        case 15: return { name: "Ограничение по времени", icon: `<img class="objIcon" src="data/OBJ15.svg" alt="15">`, isEditable: false };
        case 16: return { name: "Тaймep пpoxoждeния миccии", icon: `<img class="objIcon" src="data/OBJ16.svg" alt="16">`, isEditable: false };
        case 17: return { name: "Убрать всё оружие", icon: `<img class="objIcon" src="data/OBJ17.svg" alt="17">`, isEditable: false };
        case 18: return { name: "Телефонный звонок", icon: `<img class="objIcon" src="data/OBJ18.svg" alt="18">`, isEditable: true };
        case 19: return { name: "Объект", icon: `<img class="objIcon" src="data/OBJ19.svg" alt="19">`, isEditable: true };
        case 20: return { name: "Добавить деньги", icon: `<img class="objIcon" src="data/OBJ20.svg" alt="20">`, isEditable: false };
        case 21: return { name: "Отнять деньги", icon: `<img class="objIcon" src="data/OBJ21.svg" alt="21">`, isEditable: false };
        case 22: return { name: "Анимация игрока", icon: `<img class="objIcon" src="data/OBJ22.svg" alt="22">`, isEditable: false };
        default: return { name: `Цель типа ${type}`, icon: `<img class="objIcon" src="data/OBJ0.svg" alt="${type}">`, isEditable: false };
    }
}

function selectObjective(index) {
    const file = files.find(f => f.id === currentFile);
    if (!file) return;

    const objList = document.getElementById("objectivesList");

    file.currentObjIndex = index;
    file.currentScroll = objList.scrollTop
    renderEditor();
}

function renderEditor() {
    const missionNameINP = document.getElementById("missionName");
    const missionAuthorINP = document.getElementById("missionAuthor");
    const missionIntro1INP = document.getElementById("missionIntro1");
    const missionIntro2INP = document.getElementById("missionIntro2");
    const missionIntro3INP = document.getElementById("missionIntro3");
    const missionAudioCodeINP = document.getElementById("missionAudioCode");

    const file = files.find(f => f.id === currentFile);
    if (!file) return;

    document.getElementById("editor").style.display = "flex";
    document.getElementById("topbarObjMenu").style.display = "flex";

    missionNameINP.value = sourceTextToRU(file.data.name);
    missionNameINP.dispatchEvent(new Event('input'));
    missionAuthorINP.value = sourceTextToRU(file.data.author);
    missionAuthorINP.dispatchEvent(new Event('input'));
    missionIntro1INP.value = sourceTextToRU(file.data.intros[0]);
    missionIntro1INP.dispatchEvent(new Event('input'));
    missionIntro2INP.value = sourceTextToRU(file.data.intros[1]);
    missionIntro2INP.dispatchEvent(new Event('input'));
    missionIntro3INP.value = sourceTextToRU(file.data.intros[2]);
    missionIntro3INP.dispatchEvent(new Event('input'));
    missionAudioCodeINP.value = sourceTextToRU(file.data.audioCode);
    missionAudioCodeINP.dispatchEvent(new Event('input'));

    const objectivesPanel = document.getElementById("objectivesPanel");
    objectivesPanel.innerHTML = `
        <h3>Цели миссии</h3>
        <div class="tableHeader">
            <div style="text-align: center;">№</div>
            <div style="text-align: center;">Тип</div>
            <div>Название</div>
        </div>
        <div id="objectivesList" class="objectivesList"></div>
    `;
    const objList = document.getElementById("objectivesList");

    file.data.objectives.forEach((obj, index) => {
        const info = getObjectiveInfo(obj.type);
        
        const row = document.createElement("div");
        row.className = "objectiveRow" + (file.currentObjIndex === index ? " active" : "");
        
        row.innerHTML = `
            <div class="objIndex">${index + 1}</div>
            <div class="objIcon">${info.icon}</div>
            <div class="objName">${info.name}</div>
        `;
        
        row.onclick = () => {
            if (info.isEditable) selectObjective(index);
        };
        
        objList.appendChild(row);
    });
    objList.scrollTop = file.currentScroll;

    document.getElementById("objectiveNumber").textContent = file.currentObjIndex + 1;

    const mainPanel = document.getElementById("mainPanel");
    const missionObjectiveINP = document.getElementById("missionObjective");
    if (file.currentObjIndex !== -1) {
        mainPanel.style.display = "flex";
        missionObjectiveINP.disabled = false;
        missionObjectiveINP.value = sourceTextToRU(file.data.objectives[file.currentObjIndex].text);
        missionObjectiveINP.dispatchEvent(new Event('input'));
    } else {
        mainPanel.style.display = "none";
        missionObjectiveINP.disabled = true;
        missionObjectiveINP.value = "";
        missionObjectiveINP.dispatchEvent(new Event('input')); 
    }
    renderPreview(missionObjectiveINP.value)
}


// --------------------------------------------------------------------------- Перетаскивание вкладок


let draggedTab = null

function initTabDrag(tab) {
    tab.addEventListener("dragstart", () => {
        draggedTab = tab
        tab.classList.add("dragging")
    })

    tab.addEventListener("dragend", () => {
        tab.classList.remove("dragging")
    })
}

tabs.addEventListener("dragover", e => {
    e.preventDefault()

    const afterElement = getDragAfterElement(tabs, e.clientX)

    if (afterElement == null) {
        tabs.appendChild(draggedTab)
    } else {
        tabs.insertBefore(draggedTab, afterElement)
    }
})

function getDragAfterElement(container, x) {
    const elements = [...container.querySelectorAll(".tab:not(.dragging)")]

    return elements.reduce((closest, child) => {

        const box = child.getBoundingClientRect()
        const offset = x - box.left - box.width / 2

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child }
        } else {
            return closest
        }

    }, { offset: Number.NEGATIVE_INFINITY }).element
}

// --------------------------------------------------------------------------- Функции с текстом

// ---------------- Перевод SANLtd

const ruChar = "йцукенгшщзхъфывапролджэ\ячсмитьбю.ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭ/ЯЧСМИТЬБЮ,ёЁ";
const srcChar = "ќ yke®™ҐЎџx§ЁўaЈpoћљ›Є\¬¤cЇњ¦©—«.†‰YKE­‚ЋЉ€XђЃ‘‹AЊPO‡ѓ„“/•ЌC–…Џ’Ђ”,eЕ";

function sourceTextToRU(text) {
    return text.split("").map(c => {
        const index = srcChar.indexOf(c)
        return index !== -1 ? ruChar[index] : c
    }).join("")
}

function ruTextToSource(text) {
    return text.split("").map(c => {
        const index = ruChar.indexOf(c)
        return index !== -1 ? srcChar[index] : c
    }).join("")
}

// ---------------- Копирование и вставка текстов целей

copyObjectives.addEventListener("click", () => {
    const file = files.find(f => f.id === currentFile);
    if (!file) {
        alert("Сначала откройте файл миссии!");
        return;
    }

    const readableTexts = file.data.memory.allObjctvTXT;
    
    navigator.clipboard.writeText(JSON.stringify(readableTexts, null, 2))
        .then(() => alert("Все 100 слотов текстов целей скопированы в буфер обмена!"))
        .catch(err => {
            alert("Не удалось скопировать текст. Проверьте разрешения браузера.");
        });
});

pasteObjectives.addEventListener("click", async () => {
    const file = files.find(f => f.id === currentFile);
    if (!file) {
        alert("Сначала откройте файл миссии!");
        return;
    }

    try {
        const clipboardText = await navigator.clipboard.readText();
        const parsedTexts = JSON.parse(clipboardText);

        if (!Array.isArray(parsedTexts) || parsedTexts.length !== 100) {
            alert("Ошибка: неверный формат данных в буфере обмена. Должен быть массив из 100 строк.");
            return;
        }

        for (let i = 0; i < 100; i++) {
            const encodedText = ruTextToSource(parsedTexts[i] || "");
            
            file.data.memory.allObjctvTXT[i] = encodedText;
            
            if (file.data.objectives[i]) {
                file.data.objectives[i].text = encodedText;
            }
        }

        renderEditor();
        alert("Тексты целей успешно перенесены в миссию!");

    } catch (err) {
        console.error("Ошибка вставки:", err);
        alert("Не удалось вставить текст. Убедитесь, что в буфере обмена находятся скопированные данные целей, а не обычный текст.");
    }
});

// ---------------- Ввод текста

document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset.field && e.target.dataset.field !== "audioCode") {
        e.preventDefault();
        
        document.execCommand("insertText", false, "~n~");
    }
});

document.addEventListener("paste", (e) => {
    if (e.target.dataset.field && e.target.dataset.field !== "audioCode") {
        e.preventDefault();
        
        let pasteText = (e.clipboardData || window.clipboardData).getData("text");
        pasteText = pasteText.replace(/\n/g, "~n~");
        
        document.execCommand("insertText", false, pasteText);
    }
});

document.addEventListener("input", (e) => {
    const field = e.target.dataset.field;
    if (!field) return;

    const file = files.find(f => f.id === currentFile);
    if (!file) return;

    if (field === "objective") {
        renderPreview(e.target.value);
        if (file.currentObjIndex !== -1) {
            file.data.objectives[file.currentObjIndex].text = ruTextToSource(e.target.value);
            file.data.memory.allObjctvTXT[file.currentObjIndex] = ruTextToSource(e.target.value);
        }
        return;
    }

    file.data[field] = ruTextToSource(e.target.value);
});

document.querySelectorAll("input[maxlength], textarea[maxlength]").forEach(el => {
    const counter = el.parentElement.querySelector(".charCount")

    function updateCount() {
        counter.textContent = `${el.value.length}/${el.maxLength}`
    }

    el.addEventListener("input", updateCount)
    updateCount()
})


// --------------------------------------------------------------------------- Загрузка файлов

const loadFilePanel = document.getElementById("loadFilePanel");
const loadFile = document.getElementById("loadFile");

let dragCounter = 0;

document.addEventListener("dragenter", (e) => {
    e.preventDefault();

    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter++;
    
    if (currentFile) {
        loadFilePanel.classList.remove("hidden");
        loadFilePanel.classList.add("overlay");
    }
    
    loadFile.classList.add("dragover");
});

document.addEventListener("dragleave", (e) => {
    e.preventDefault();

    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter--;
    
    if (dragCounter === 0) {
        loadFile.classList.remove("dragover");
        
        if (currentFile) {
            loadFilePanel.classList.add("hidden");
            loadFilePanel.classList.remove("overlay");
        }
    }
});

document.addEventListener("dragover", (e) => {
    e.preventDefault();
});

document.addEventListener("drop", async (e) => {
    e.preventDefault();
    
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter = 0;
    loadFile.classList.remove("dragover");

    if (e.dataTransfer && e.dataTransfer.files) {
        for (const file of e.dataTransfer.files) {
            await openFile(file);
        }
    }

    if (currentFile) {
        loadFilePanel.classList.add("hidden");
        loadFilePanel.classList.remove("overlay");
    }
});

fileInput.addEventListener("change", async (e) => {
    if (e.target.files) {
        for (const file of e.target.files) {
            await openFile(file);
        }
    }

    if (currentFile) {
        loadFilePanel.classList.add("hidden");
        loadFilePanel.classList.remove("overlay");
    }

    fileInput.value = "";
});

fileSave.addEventListener("click", () => {
    if (currentFile) {
        saveDYOM(currentFile)
    }
})

// --------------------------------------------------------------------------- Предпросмотр текста целей

const textColors = {
    "r": "#901D23",
    "g": "#2E5A2F",
    "b": "#2A386F",
    "y": "#B49E59", "у": "#B49E59",
    "p": "#875ED1", "р": "#875ED1",
    "l": "#03090C",

    "w": "#B4B7BC",
    "s": "#B4B7BC"
}

function lightenColor(hex) {
    hex = hex.replace(/^#/, '');
    
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    r = Math.min(255, r * 1.35);
    g = Math.min(255, g * 1.35);
    b = Math.min(255, b * 1.35);

    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase()}`;
}

function renderPreview(text) {
    const previewContainer = document.querySelector("#objectivePreview p");
    
    if (!text) {
        previewContainer.innerHTML = "";
        return;
    }

    let currentColor = textColors["s"];
    let resultHTML = `<span style="color: ${currentColor}">`;

    const parts = text.split(/(~[a-zA-Zа-яА-ЯёЁ]*~|~)/);

    for (let i = 0; i < parts.length; i++) {
        let part = parts[i];
        if (!part) continue;

        const colorMatch = part.toLowerCase().match(/^~([a-zа-яё]*)~$/);

        if (colorMatch) {
            const tag = colorMatch[1];
            
            if (tag === 'n') {
                resultHTML += `<br>`;
            } 
            else if (tag === 'h') { 
                currentColor = lightenColor(currentColor);
                resultHTML += `</span><span style="color: ${currentColor}">`;
            } 
            else if (tag === '') {
                currentColor = textColors["s"];
                resultHTML += `</span><span style="color: ${currentColor}">`;
            }
            else if (textColors[tag]) {
                currentColor = textColors[tag];
                resultHTML += `</span><span style="color: ${currentColor}">`;
            } 
            else {
                const unknownStyle = "background: #000000; color: white; border-radius: 3px; padding: 0 2px; font-size: 0.8em;";
                resultHTML += `<span style="${unknownStyle}" title="Неизвестный тег: ${tag}">?${tag}?</span>`;
            }
        } else {
            if (part.includes('~')) {
                const errorStyle = "border-bottom: 2px wavy red; background-color: rgb(255, 0, 0);";
                let safeText = part.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                resultHTML += `<span style="${errorStyle}" title="Тильда не закрыта!">${safeText}</span>`;
            } else {
                let safeText = part.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                safeText = safeText.replace(/\n/g, "<br>").replace(/_/g, "&nbsp;"); 
                resultHTML += safeText;
            }
        }
    }

    resultHTML += '</span>';
    previewContainer.innerHTML = resultHTML;
}

// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".tokenTable tbody tr").forEach(row => {
        const token = row.querySelector("th").textContent
            .replace(/~/g, "");

        if (textColors[token]) {
            row.querySelector(".tokenPreview").style.color = textColors[token];
            row.querySelector(".tokenPreview").style.fontWeight = "bold";
        }
    });
});