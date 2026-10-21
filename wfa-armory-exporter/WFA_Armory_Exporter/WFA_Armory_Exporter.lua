local ADDON = "WFA Armory Exporter"
local VERSION = "0.1.7"

WFAArmoryExportDB = WFAArmoryExportDB or {}

local slots = {
  { id = 1, key = "head" },
  { id = 2, key = "neck" },
  { id = 3, key = "shoulder" },
  { id = 4, key = "shirt" },
  { id = 5, key = "chest" },
  { id = 6, key = "waist" },
  { id = 7, key = "legs" },
  { id = 8, key = "feet" },
  { id = 9, key = "wrist" },
  { id = 10, key = "hands" },
  { id = 11, key = "finger1" },
  { id = 12, key = "finger2" },
  { id = 13, key = "trinket1" },
  { id = 14, key = "trinket2" },
  { id = 15, key = "back" },
  { id = 16, key = "mainhand" },
  { id = 17, key = "offhand" },
  { id = 18, key = "ranged" },
  { id = 19, key = "tabard" },
}

local function safeCall(fn, ...)
  if type(fn) ~= "function" then return nil end
  local results = { pcall(fn, ...) }
  if not results[1] then return nil end
  return unpack(results, 2, math.max(2, table.maxn(results)))
end

local function itemQuality(link)
  if not link then return nil end
  local _, _, quality = safeCall(GetItemInfo, link)
  -- GetItemInfo is empty until the item is cached; the link itself carries
  -- the quality as |cnIQ<n>: on WoW Forever 1.60.x clients.
  return tonumber(quality) or tonumber(tostring(link):match("|cnIQ(%d+)"))
end

-- Transmogrification of an equipped slot: the item whose appearance is shown,
-- or hidden = true. Uses the client's C_Transmog API when it exists; on a
-- client without it the slot simply carries no look.
local function transmogLook(slotId, itemId)
  if not C_Transmog or type(C_Transmog.GetSlotVisualInfo) ~= "function" then return nil end
  local location
  if TransmogUtil and TransmogUtil.GetTransmogLocation and Enum and Enum.TransmogType and Enum.TransmogModification then
    location = safeCall(TransmogUtil.GetTransmogLocation, slotId, Enum.TransmogType.Appearance, Enum.TransmogModification.Main)
  end
  local _, baseSource, appliedSource, hidden
  if location then
    baseSource, _, appliedSource, _, _, _, _, hidden = safeCall(C_Transmog.GetSlotVisualInfo, location)
  else
    baseSource, _, appliedSource, _, _, _, _, hidden = safeCall(C_Transmog.GetSlotVisualInfo, slotId, LE_TRANSMOG_TYPE_APPEARANCE or 0)
  end
  if hidden == true then return nil, true end
  appliedSource = tonumber(appliedSource)
  if not appliedSource or appliedSource <= 0 or appliedSource == tonumber(baseSource) then return nil end
  local info = C_TransmogCollection and safeCall(C_TransmogCollection.GetSourceInfo, appliedSource)
  local lookId = type(info) == "table" and tonumber(info.itemID) or nil
  if lookId and lookId > 0 and lookId ~= itemId then return lookId end
  return nil
end

local function round(value, digits)
  value = tonumber(value)
  if not value then return nil end
  local factor = 10 ^ (digits or 2)
  return math.floor(value * factor + 0.5) / factor
end

-- Values exactly as the client reports them; anything the API does not
-- provide stays nil instead of being estimated.
local PRIMARY_STATS = { "strength", "agility", "stamina", "intellect", "spirit" }
local SPELL_SCHOOLS = { "physical", "holy", "fire", "nature", "frost", "shadow", "arcane" }

local function captureStats()
  local stats = {}

  stats.health_max = tonumber(safeCall(UnitHealthMax, "player"))
  local _, powerToken = safeCall(UnitPowerType, "player")
  stats.power_type = powerToken
  stats.power_max = tonumber(safeCall(UnitPowerMax, "player"))

  stats.primary = {}
  for index, key in ipairs(PRIMARY_STATS) do
    local base, effective, positive, negative = safeCall(UnitStat, "player", index)
    if base or effective then
      stats.primary[key] = { base = base, effective = effective, bonus = positive, penalty = negative }
    end
  end

  local armorBase, armorEffective, _, armorPositive, armorNegative = safeCall(UnitArmor, "player")
  if armorBase or armorEffective then
    stats.armor = { base = armorBase, effective = armorEffective, bonus = armorPositive, penalty = armorNegative }
  end

  local apBase, apPositive, apNegative = safeCall(UnitAttackPower, "player")
  local minDamage, maxDamage, minOffhand, maxOffhand = safeCall(UnitDamage, "player")
  local mainSpeed, offSpeed = safeCall(UnitAttackSpeed, "player")
  stats.melee = {
    attack_power = apBase and { base = apBase, bonus = apPositive, penalty = apNegative } or nil,
    crit_chance = round(safeCall(GetCritChance)),
    hit_bonus = round(safeCall(GetHitModifier)),
    damage_min = round(minDamage, 1),
    damage_max = round(maxDamage, 1),
    offhand_damage_min = round(minOffhand, 1),
    offhand_damage_max = round(maxOffhand, 1),
    speed = round(mainSpeed),
    offhand_speed = round(offSpeed),
  }

  local rapBase, rapPositive, rapNegative = safeCall(UnitRangedAttackPower, "player")
  local rangedSpeed, rangedMin, rangedMax = safeCall(UnitRangedDamage, "player")
  stats.ranged = {
    attack_power = rapBase and { base = rapBase, bonus = rapPositive, penalty = rapNegative } or nil,
    crit_chance = round(safeCall(GetRangedCritChance)),
    damage_min = round(rangedMin, 1),
    damage_max = round(rangedMax, 1),
    speed = round(rangedSpeed),
  }

  stats.spell = {
    bonus_healing = tonumber(safeCall(GetSpellBonusHealing)),
    hit_bonus = round(safeCall(GetSpellHitModifier)),
    crit_chance = {},
    bonus_damage = {},
  }
  for school = 2, #SPELL_SCHOOLS do
    local key = SPELL_SCHOOLS[school]
    stats.spell.crit_chance[key] = round(safeCall(GetSpellCritChance, school))
    stats.spell.bonus_damage[key] = tonumber(safeCall(GetSpellBonusDamage, school))
  end
  local baseRegen, castingRegen = safeCall(GetManaRegen)
  stats.spell.mana_regen = baseRegen and { base = round(baseRegen), casting = round(castingRegen) } or nil

  stats.defense = {
    dodge_chance = round(safeCall(GetDodgeChance)),
    parry_chance = round(safeCall(GetParryChance)),
    block_chance = round(safeCall(GetBlockChance)),
  }

  stats.resistances = {}
  for school = 2, #SPELL_SCHOOLS do
    local base, total = safeCall(UnitResistance, "player", school - 1)
    if base or total then
      stats.resistances[SPELL_SCHOOLS[school]] = { base = base, total = total }
    end
  end

  return stats
end

local function capture()
  -- While the world is loading or being torn down (logout, /reload) the
  -- client reports an empty inventory and zero stats; keep the last good
  -- snapshot instead of overwriting it with that.
  local healthMax = tonumber(safeCall(UnitHealthMax, "player"))
  if not healthMax or healthMax <= 0 then return nil end

  local localizedRace, raceToken, raceId = safeCall(UnitRace, "player")
  local localizedClass, classToken = safeCall(UnitClass, "player")
  local faction, factionName = safeCall(UnitFactionGroup, "player")
  local version, build, buildDate, interface = safeCall(GetBuildInfo)
  local gender = tonumber(safeCall(UnitSex, "player"))
  local equipment = {}

  for _, slot in ipairs(slots) do
    local id = tonumber(safeCall(GetInventoryItemID, "player", slot.id))
    local link = safeCall(GetInventoryItemLink, "player", slot.id)
    local texture = safeCall(GetInventoryItemTexture, "player", slot.id)
    if id or link then
      local lookId, lookHidden = transmogLook(slot.id, id)
      equipment[slot.key] = {
        slot_id = slot.id,
        item_id = id,
        item_link = link,
        quality = itemQuality(link),
        icon = texture,
        look_item_id = lookId,
        look_hidden = lookHidden or nil,
      }
    end
  end

  local name = safeCall(UnitName, "player")
  local realm = safeCall(GetRealmName)
  local level = tonumber(safeCall(UnitLevel, "player"))
  local guid = safeCall(UnitGUID, "player")

  WFAArmoryExportDB.latest = {
    schema = "wfa-armory-export-v1",
    addon_version = VERSION,
    captured_at = date and date("!%Y-%m-%dT%H:%M:%SZ") or nil,
    client = {
      version = version,
      build = build,
      build_date = buildDate,
      interface = interface,
    },
    character = {
      name = name,
      realm = realm,
      level = level,
      guid = guid,
      race = localizedRace,
      race_token = raceToken,
      race_id = tonumber(raceId),
      class = localizedClass,
      class_token = classToken,
      gender_id = gender,
      faction = faction,
      faction_name = factionName,
    },
    equipment = equipment,
    stats = captureStats(),
  }
  WFAArmoryExportDB.updated_at = WFAArmoryExportDB.latest.captured_at
  return equipment
end

local function countEquipment(equipment)
  local count = 0
  for _, item in pairs(equipment or {}) do
    if item.item_id then count = count + 1 end
  end
  return count
end

local function report()
  local equipment = capture()
  if not equipment then
    print("WFA Armory Exporter: данные персонажа ещё не загружены, снимок не изменён. Повторите через пару секунд.")
    return false
  end
  local data = WFAArmoryExportDB.latest
  local character = data and data.character or {}
  local build = data and data.client and data.client.build or "не определён"
  local identity = (character.name or "персонаж") .. " · " .. (character.race or "раса неизвестна") .. " · " .. (character.class or "класс неизвестен")
  print("WFA Armory Exporter: сохранены данные " .. identity)
  print("Экипировка: " .. countEquipment(equipment) .. " предметов; build клиента: " .. tostring(build) .. ".")
  local stats = data and data.stats or {}
  local primary = stats.primary or {}
  local function effective(key) return primary[key] and primary[key].effective or "?" end
  print("Характеристики: сила " .. tostring(effective("strength")) .. ", ловкость " .. tostring(effective("agility")) ..
    ", выносливость " .. tostring(effective("stamina")) .. ", интеллект " .. tostring(effective("intellect")) ..
    ", дух " .. tostring(effective("spirit")) .. "; броня " .. tostring(stats.armor and stats.armor.effective or "?") .. ".")
  return true
end

-- JSON for the Armory's "импорт JSON профиля" field. Keys are sorted so the
-- same character always gives the same text; "|" is written as | so the
-- game's edit box shows item links as plain text instead of parsing them.
local function jsonString(value)
  return '"' .. tostring(value):gsub('[%c"\\|]', function(char)
    if char == '"' then return '\\"' end
    if char == "\\" then return "\\\\" end
    if char == "\n" then return "\\n" end
    if char == "\r" then return "\\r" end
    if char == "\t" then return "\\t" end
    return string.format("\\u%04x", string.byte(char))
  end) .. '"'
end

local function toJson(value)
  local kind = type(value)
  if kind == "table" then
    local keys = {}
    for key in pairs(value) do keys[#keys + 1] = tostring(key) end
    table.sort(keys)
    local parts = {}
    for _, key in ipairs(keys) do
      local item = value[key]
      if item == nil then item = value[tonumber(key)] end
      local encoded = toJson(item)
      if encoded then parts[#parts + 1] = jsonString(key) .. ":" .. encoded end
    end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif kind == "string" then
    return jsonString(value)
  elseif kind == "number" then
    if value ~= value or value == math.huge or value == -math.huge then return "null" end
    if value == math.floor(value) and math.abs(value) < 2 ^ 53 then return string.format("%d", value) end
    return string.format("%.14g", value)
  elseif kind == "boolean" then
    return value and "true" or "false"
  end
  return nil
end

-- Telegram link for the Armory mini app, the format src/wf-characters.mjs
-- reads: "WFA1_" + base64url(UTF-8 "1;raceId;unitSex;CLASS;level;name;realm;slot.item[.look],...");
-- look is the transmog item ID or "x" for a hidden slot.
-- Telegram allows 512 characters of [A-Za-z0-9_-] in startapp, so the link
-- carries appearance and gear only; stats travel in the JSON.
local LINK_PREFIX = "https://t.me/WoWForeverRUBot?startapp="
local START_PARAM_LIMIT = 512
local RACE_IDS = { Human = 1, Orc = 2, Dwarf = 3, NightElf = 4, Scourge = 5, Tauren = 6, Gnome = 7, Troll = 8 }
local BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

local function base64url(text)
  local out = {}
  for i = 1, #text, 3 do
    local a, b, c = string.byte(text, i, i + 2)
    local n = a * 65536 + (b or 0) * 256 + (c or 0)
    local chars = 2 + (b and 1 or 0) + (c and 1 or 0)
    for k = 1, chars do
      local index = math.floor(n / 2 ^ (6 * (4 - k))) % 64
      out[#out + 1] = BASE64URL:sub(index + 1, index + 1)
    end
  end
  return table.concat(out)
end

local function clean(value)
  return (tostring(value or ""):gsub("[;,%c]", " "))
end

local function telegramLink(data)
  local c = data and data.character or {}
  local race = tonumber(c.race_id) or RACE_IDS[tostring(c.race_token or ""):gsub("%s", "")]
  if not race then return nil, "раса персонажа не определена" end
  local gear = {}
  for _, slot in ipairs(slots) do
    local item = data.equipment and data.equipment[slot.key]
    local id = item and tonumber(item.item_id)
    if id and id > 0 then
      local entry = slot.id .. "." .. id
      if item.look_hidden then entry = entry .. ".x"
      elseif tonumber(item.look_item_id) then entry = entry .. "." .. tonumber(item.look_item_id) end
      gear[#gear + 1] = entry
    end
  end
  local fields = { "1", race, tonumber(c.gender_id) or 2, clean(c.class_token), tonumber(c.level) or "", clean(c.name), clean(c.realm), table.concat(gear, ",") }
  local code = "WFA1_" .. base64url(table.concat(fields, ";"))
  if #code > START_PARAM_LIMIT then return nil, "данные не помещаются в ссылку Telegram" end
  return LINK_PREFIX .. code
end

local exportFrame

local function createButton(parent, text, width)
  local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  button:SetSize(width, 24)
  button:SetText(text)
  return button
end

local function getExportFrame()
  if exportFrame then return exportFrame end
  local ok, frame = pcall(CreateFrame, "Frame", "WFAArmoryExportFrame", UIParent, "BasicFrameTemplateWithInset")
  if not ok or not frame then
    frame = CreateFrame("Frame", "WFAArmoryExportFrame", UIParent)
    local background = frame:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetColorTexture(0.03, 0.07, 0.12, 0.95)
  end
  frame:SetSize(560, 360)
  frame:SetPoint("CENTER")
  frame:SetFrameStrata("DIALOG")
  frame:SetMovable(true)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
  frame:SetClampedToScreen(true)
  tinsert(UISpecialFrames, "WFAArmoryExportFrame")

  local title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  title:SetPoint("TOP", 0, -6)
  title:SetText("WFA Armory Exporter " .. VERSION)

  local hint = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  hint:SetPoint("TOPLEFT", 14, -30)
  hint:SetPoint("TOPRIGHT", -14, -30)
  hint:SetJustifyH("LEFT")
  frame.hint = hint

  local scroll = CreateFrame("ScrollFrame", "WFAArmoryExportScroll", frame, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 14, -62)
  scroll:SetPoint("BOTTOMRIGHT", -34, 44)

  local edit = CreateFrame("EditBox", nil, scroll)
  edit:SetMultiLine(true)
  edit:SetAutoFocus(false)
  edit:SetFontObject(ChatFontNormal)
  edit:SetWidth(500)
  edit:SetMaxLetters(0)
  edit:SetScript("OnEscapePressed", function() frame:Hide() end)
  -- Read-only: any typing restores the export so a stray key cannot spoil it.
  edit:SetScript("OnTextChanged", function(self, userInput)
    if userInput and frame.text then self:SetText(frame.text); self:HighlightText() end
  end)
  edit:SetScript("OnMouseUp", function(self) self:HighlightText() end)
  scroll:SetScrollChild(edit)
  frame.edit = edit

  local json = createButton(frame, "JSON для сайта", 130)
  json:SetPoint("BOTTOMLEFT", 14, 12)
  json:SetScript("OnClick", function() frame:ShowMode("json") end)

  local link = createButton(frame, "Ссылка для Telegram", 160)
  link:SetPoint("LEFT", json, "RIGHT", 6, 0)
  link:SetScript("OnClick", function() frame:ShowMode("link") end)

  local save = createButton(frame, "Сохранить файл", 130)
  save:SetPoint("LEFT", link, "RIGHT", 6, 0)
  save:SetScript("OnClick", function() ReloadUI() end)
  save:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine("Перезагрузить интерфейс (/reload), чтобы игра записала")
    GameTooltip:AddLine("WTF\\...\\SavedVariables\\WFA_Armory_Exporter.lua", 1, 1, 1)
    GameTooltip:Show()
  end)
  save:SetScript("OnLeave", function() GameTooltip:Hide() end)

  local close = createButton(frame, "Закрыть", 80)
  close:SetPoint("BOTTOMRIGHT", -14, 12)
  close:SetScript("OnClick", function() frame:Hide() end)

  function frame:ShowMode(mode)
    local data = WFAArmoryExportDB.latest
    if mode == "link" then
      local url, problem = telegramLink(data)
      self.text = url or ""
      self.hint:SetText(url and "Ссылка выделена: нажмите Ctrl+C и отправьте её в любой чат Telegram. По нажатию откроется Оружейная с этим персонажем (раса, экипировка и трансмог; характеристики — только в JSON)."
        or ("Не удалось собрать ссылку: " .. tostring(problem) .. "."))
    else
      self.text = toJson(data)
      self.hint:SetText("JSON выделен: нажмите Ctrl+C и вставьте его в Оружейной в поле «Дополнительно: импорт JSON профиля» → «Показать данные из JSON».")
    end
    json:SetEnabled(mode == "link")
    link:SetEnabled(mode ~= "link")
    self:Show()
    self.edit:SetText(self.text)
    self.edit:SetCursorPosition(0)
    self.edit:SetFocus()
    self.edit:HighlightText()
  end

  frame:Hide()
  exportFrame = frame
  return frame
end

local function showExport(mode)
  if not report() then return end
  getExportFrame():ShowMode(mode or "json")
end

local function showSummary()
  local data = WFAArmoryExportDB.latest
  if not data then
    print("WFA Armory Exporter: нет сохранённого снимка. Нажмите кнопку у мини-карты или введите /wfa export.")
    return
  end
  local c = data.character or {}
  print("WFA: " .. tostring(c.name or "?") .. " / " .. tostring(c.race or "?") .. " / " .. tostring(c.class or "?"))
  print("Экипировка: " .. countEquipment(data.equipment) .. " предметов.")
end

-- Minimap button: left click exports and opens the JSON window, right click
-- prints a summary, dragging moves it around the minimap (angle is saved).
local minimapButton

local function placeMinimapButton()
  local angle = math.rad(tonumber(WFAArmoryExportDB.minimap_angle) or 210)
  local radius = (Minimap:GetWidth() / 2) + 10
  minimapButton:ClearAllPoints()
  minimapButton:SetPoint("CENTER", Minimap, "CENTER", math.cos(angle) * radius, math.sin(angle) * radius)
end

local function dragMinimapButton()
  local x, y = GetCursorPosition()
  local scale = Minimap:GetEffectiveScale()
  local cx, cy = Minimap:GetCenter()
  local angle = math.deg(math.atan2(y / scale - cy, x / scale - cx))
  WFAArmoryExportDB.minimap_angle = math.floor(angle * 10 + 0.5) / 10
  placeMinimapButton()
end

local function createMinimapButton()
  if minimapButton or not Minimap then return end
  local button = CreateFrame("Button", "WFAArmoryMinimapButton", Minimap)
  button:SetSize(31, 31)
  button:SetFrameStrata("MEDIUM")
  button:SetFrameLevel(8)
  button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  button:RegisterForDrag("LeftButton")
  button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

  local background = button:CreateTexture(nil, "BACKGROUND")
  background:SetTexture("Interface\\Minimap\\UI-Minimap-Background")
  background:SetSize(20, 20)
  background:SetPoint("TOPLEFT", 7, -5)

  local icon = button:CreateTexture(nil, "ARTWORK")
  icon:SetTexture("Interface\\Icons\\INV_Chest_Chain_05")
  icon:SetSize(17, 17)
  icon:SetPoint("TOPLEFT", 7, -6)
  icon:SetTexCoord(0.05, 0.95, 0.05, 0.95)

  local border = button:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  border:SetSize(53, 53)
  border:SetPoint("TOPLEFT")

  button:SetScript("OnClick", function(_, mouseButton)
    if mouseButton == "RightButton" then showSummary()
    elseif IsShiftKeyDown() then showExport("link")
    else showExport("json") end
  end)
  button:SetScript("OnDragStart", function(self) self:SetScript("OnUpdate", dragMinimapButton) end)
  button:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
  button:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("WFA Armory Exporter " .. VERSION)
    GameTooltip:AddLine("Левая кнопка: JSON для Оружейной (с характеристиками)", 1, 1, 1)
    GameTooltip:AddLine("Shift + левая кнопка: ссылка для Telegram", 1, 1, 1)
    GameTooltip:AddLine("Правая кнопка: краткая сводка в чат", 1, 1, 1)
    GameTooltip:AddLine("Перетащите, чтобы переместить кнопку", 0.7, 0.7, 0.7)
    GameTooltip:Show()
  end)
  button:SetScript("OnLeave", function() GameTooltip:Hide() end)

  minimapButton = button
  if WFAArmoryExportDB.minimap_hidden then button:Hide() end
  placeMinimapButton()
end

SLASH_WFAARMORYEXPORTER1 = "/wfa"
SLASH_WFAARMORYEXPORTER2 = "/wfexport"
SlashCmdList = SlashCmdList or {}
SlashCmdList.WFAARMORYEXPORTER = function(message)
  local command = (message or ""):lower():match("^%s*(%S*)")
  if command == "" or command == "export" or command == "json" then
    showExport("json")
  elseif command == "link" then
    showExport("link")
  elseif command == "show" then
    showSummary()
  elseif command == "button" then
    WFAArmoryExportDB.minimap_hidden = not WFAArmoryExportDB.minimap_hidden
    if minimapButton then minimapButton:SetShown(not WFAArmoryExportDB.minimap_hidden) end
    print("WFA Armory Exporter: кнопка у мини-карты " .. (WFAArmoryExportDB.minimap_hidden and "скрыта" or "показана") .. ".")
  else
    print("Команды: /wfa — JSON для Оружейной; /wfa link — ссылка для Telegram; /wfa show — краткая сводка; /wfa button — скрыть или показать кнопку у мини-карты.")
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
frame:RegisterEvent("UNIT_INVENTORY_CHANGED")
frame:SetScript("OnEvent", function(_, event, unit)
  if event == "UNIT_INVENTORY_CHANGED" and unit ~= "player" then return end
  capture()
  if event == "PLAYER_LOGIN" then
    createMinimapButton()
    print("WFA Armory Exporter " .. VERSION .. " готов. Нажмите кнопку у мини-карты, чтобы выгрузить персонажа для Оружейной.")
  end
end)
