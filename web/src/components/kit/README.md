# kit — UI-примитивы «Отпусков»

Импорт одной строкой: `import { Button, Card, Select, DateRangePicker, toast } from "@/components/kit"`.
Витрина всех элементов во всех состояниях — **http://localhost:3400/kit** (`src/app/kit/KitShowcase.tsx`, там же примеры кода).
Иконки — `lucide-react` (`import { Check } from "lucide-react"`), передаются в `icon` компонентом, не элементом.

## Стиль

- Фон приложения `--bg #F5F5F7`, карточки белые без рамок, отделяются мягкой многослойной тенью `shadow-1` (поповеры и окна — `shadow-3`).
- Шрифт Inter (`next/font`), цифры в таблицах и датах — класс `tnum`. Заголовки: страница 32/600/−0.032em (`PageHeader`), секция 19/600 (`Section`).
- Акцент — фирменный мятный Авистрейда `--accent #00AC80`: действия и выбор (основные кнопки, переключатели, галочки, фокус, выделение).
  На белом он светлый, поэтому заливка кнопок и текст-акцент — тёмный `--accent-strong #00876A` (белый текст 4,5:1), чистый мятный — у знака,
  переключателей и колец фокуса. Классы: `bg-accent-strong`, `text-accent-strong`, `bg-accent-bg`, `bg-accent`.
- **Три смысла — три цвета:** мятный — «нажми / выбрано», зелёный `--ok` — «согласовано», синий `--vacation #0A84FF` — «свой отпуск»
  (и выбор дат в календаре: выбираешь даты своего отпуска). Пилюля своего отпуска — `tone="vacation"`, не `accent`.
- Статусы — насыщенный текст + тонированный фон: `ok / warn / bad / info` (`text-ok`, `bg-ok-bg`…).
- Шапка: знак Авистрейда `public/brand/avistrade-mark.svg` (только знак, без слова) и «Отпуска» обычным текстом.
- Календарь: выходные и праздники красным `--weekend`, праздник ещё и подчёркнут. Загрузка группы: `--load-free` свободно, `--load-one` одно место, `--load-full` мест нет, `--vacation-bg` свой отпуск.
- Движение: `--ease-spring`, `--dur-1/2/3` (140/240/380 мс); при `prefers-reduced-motion` длительности 0. Нажатие — класс `press` (лёгкое сжатие).
- Все токены — CSS-переменные в `src/app/globals.css`, в Tailwind доступны как цвета: `bg-surface`, `bg-fill-2`, `text-muted`, `bg-accent-bg`, `bg-load-one`, `text-weekend`, `shadow-1`, `rounded-panel/block/control`.

### Токены

| Группа | Токены |
|---|---|
| Поверхности | `--bg`, `--surface`, `--surface-alt`, `--fill` / `--fill-2` / `--fill-3` (заливки контролов), `--line` / `--line-soft` (волосяные линии), `--glass` |
| Текст | `--text`, `--text-2`, `--muted`, `--muted-2` |
| Акцент и статусы | `--brand`, `--accent`, `--accent-strong`, `--accent-bg`, `--ok(-bg)`, `--warn(-bg)`, `--bad(-bg)`, `--info(-bg)` |
| Календарь | `--vacation`, `--vacation-strong` (выбранный день), `--vacation-bg`, `--weekend`, `--holiday`, `--load-free`, `--load-one`, `--load-full` |
| Радиусы | `--r-panel 28`, `--r-block 20`, `--r-control 12`, `--r-thumb 9`, `--r-pill`; `--r-in` — внутренний радиус текущей Surface |
| Тени | `--shadow-1` (карточка), `--shadow-2`, `--shadow-3` (поповер, окно), `--ring` (фокус) |

Старые имена (`--header`, `--line`, `--info-bg`, `--radius`…) и классы `.card .btn .chip .tbl` оставлены и перекрашены — экраны работают, пока их не перевели на kit. В новом коде их не использовать.

## Правило концентричности

**Внутренний радиус = внешний радиус − отступ.** Шкала: панель 28 → блок 20 → контрол 12 → ползунок 9 → пилюля (капсула).

Как это держится в коде, чтобы не нарушить случайно:

1. `Surface` (и `Card`) знает свой радиус и отступ и кладёт в контекст и в CSS-переменную `--r-in` внутренний радиус `r − pad`.
2. Пресеты подобраны так, что у края выходит ровно 12 — радиус контролов:
   - `level="panel"` — 28, отступ 16 → 12 (обычная карточка);
   - `level="inset"` — 28, отступ 8 → 20: внутри лежат блоки `<Surface nested>` (радиус берут у родителя = 20), а у блока отступ 8 → 12;
   - `level="block"` — 20, отступ 8 → 12 (поповер, блок).
3. Вложенная поверхность — всегда `<Surface nested>`: радиус она не задаёт, а берёт у родителя.
4. Кнопки, поля, Select, сегменты — радиус 12 (или капсула, если ниже 24 px). Если увеличиваете `pad` у карточки, контролы уже не у края и правило их не касается; но **блок у края** кладите через `nested`.
5. Свой элемент у края поверхности — класс `r-in` (`border-radius: var(--r-in)`) или хук `useInnerRadius()`.
6. Пилюли, аватары, переключатели — капсулы: они концентричны чему угодно.

Нельзя: задавать `rounded-[..]` вручную блокам внутри карточки; ставить `rounded-md/lg` контролам; рамки `border` вместо теней у карточек.

## Примитивы

### Поверхности — `Surface.tsx`
- `Surface` — `level?: "panel" | "inset" | "block"`, `nested?`, `pad?: number`, `tone?: "raised" | "flat" | "tinted"`, `as?`, `className`, `style`. raised — белая с тенью (по умолчанию для panel), flat — `--surface-alt` (по умолчанию для nested и block), tinted — лёгкая заливка.
- `Card` — `Surface level="panel"`.
- `Section` — `title`, `description?`, `action?` (кнопки справа от заголовка), `pad?`, `children` в карточке.
- `PageHeader` — `title`, `subtitle?`, `actions?`.
- `useInnerRadius()`, `useControlRadius(h)`, константы `R`.

### Кнопки — `Button.tsx`
- `Button` — `variant?: "primary" | "secondary" | "tinted" | "ghost" | "destructive"` (по умолчанию secondary), `size?: "sm" | "md" | "lg"` (30/36/44), `icon?`, `iconRight?`, `loading?` (спиннер, кнопка неактивна), `block?` (на всю ширину), `pill?` (капсула), плюс все атрибуты `<button>`.
- `IconButton` — `icon`, `label` (обязательно: aria-label и подсказка kit при наведении), `variant?` (ghost), `size?`, `round?` (по умолчанию круглая), `loading?`, `noTooltip?`.
- `ButtonRow` — ряд кнопок с отступом 8. `Spinner` — `size?`.

### Статусы — `Pill.tsx`
- `Pill` — `tone?: "ok" | "warn" | "bad" | "info" | "neutral" | "accent" | "vacation"`, `dot?`, `icon?`, `size?: "sm" | "md"`, `title?: ReactNode` — подсказка kit при наведении и фокусе.
- `Badge` — счётчик в кружке, `tone?` (accent).

### Переключение — `SegmentedControl.tsx`
- `SegmentedControl` — `options: { value, label, icon?, disabled? }[]`, `value`, `onChange`, `size?: "sm" | "md"`, `block?`. Ползунок едет с пружинкой, стрелки ← → переключают.
- `Tabs` — `tabs: { value, label, icon?, count?, disabled? }[]`, `value`, `onChange`. Полоска под активной вкладкой.

### Поля — `Form.tsx`
- `Field` — `label?`, `hint?`, `error?` (красным вместо подсказки), `htmlFor?`, `children`.
- `Input` — `icon?`, `invalid?`, `size?: "sm" | "md" | "lg"`, `trailing?` (единицы справа), атрибуты `<input>`.
- `Textarea` — `invalid?`, атрибуты `<textarea>`.
- `NumberStepper` — `value`, `onChange`, `min?`, `max?`, `step?`, `suffix?` («дней»), `disabled?`. Стрелки ↑ ↓ меняют.
- `Switch` — `checked`, `onChange`, `label?`, `description?`, `disabled?`.
- `Checkbox` — `checked`, `onChange`, `indeterminate?`, `label?`, `description?`, `disabled?`.

### Всплывающие — `Popover.tsx`, `Menu.tsx`, `Select.tsx`
Все на `@floating-ui/react`: переворот у края экрана, Esc и клик мимо закрывают, порталы. Триггер — единственный ребёнок (элемент, умеющий `ref`: наши Button/IconButton или DOM-элемент).
- `Popover` — `content` (узел или `(close) => узел`), `children` (триггер), `open?` / `onOpenChange?` (можно управлять снаружи), `placement?`, `width?`, `pad?` (16).
- `Tooltip` — `content`, `children`, `placement?` (top), `delay?` (350 мс). Тёмный пузырь со стрелкой по наведению и фокусу.
  **Нативный `title` в интерфейсе не используем** — только `Tooltip` (или `title` у `Pill`, `label` у `IconButton`, которые рисуют его сами).
  Триггеры можно вкладывать: обработчики и ref ребёнка сохраняются (IconButton с подсказкой — триггер Menu или Popover).
- `Menu` — `items: ({ label, icon?, onSelect, destructive?, disabled?, hint? } | { separator: true } | { heading })[]`, `children` (триггер), `placement?` (bottom-end), `width?`. Стрелки, Enter, ввод букв.
- `Select` — `options: { value, label, description?, leading?, group?, disabled? }[]`, `value | null`, `onChange`, `placeholder?`, `searchable?` (по умолчанию при > 8 опций), `size?`, `invalid?`, `disabled?`, `menuWidth?`, `placement?`, `header?` (пояснение над списком), `renderTrigger?: (selected, open) => узел` — свой триггер (так сделан «Войти как…» в шапке). Опции с одинаковым `group` идут под общим заголовком; у выбранной — галочка.

### Окна — `Dialog.tsx`, `Toast.tsx`
- `Dialog` — `open`, `onClose`, `title?`, `description?`, `children`, `footer?` (кнопки справа), `width?` (480), `persistent?` (не закрывать кликом по фону).
- `Sheet` — то же, панель справа островом, `width?` (440); `footer` — кнопки на всю ширину (`block`).
- `toast(title, { description?, tone?: "ok" | "warn" | "bad" | "info", action?: { label, onClick }, duration? })` — уведомление снизу по центру; `toast.dismiss(id)`. `ToastProvider` уже смонтирован в `layout.tsx`.

### Даты — `Calendar.tsx`
Выходные (с учётом переносов рабочих дней) и праздники РБ — из `@/domain/calendar`: красным, праздник подчёркнут, название — в подсказке и строке под месяцем. Даты — строки ISO `YYYY-MM-DD`.
- `DatePicker` — `value | null`, `onChange(iso)`, `min?`, `max?`, `placeholder?`, `size?`, `invalid?`, `disabled?`, `placement?`, `dayTone?`, `dayDecorator?`. Закрывается после выбора.
- `DateRangePicker` — `value: { start, end }`, `onChange({ start, end })` (по «Готово»), `months?: 1 | 2` (2), `min?`, `max?`, `defaultMonth?`, `dayTone?`, `dayDecorator?`, `footnote?` (например, `<CalendarLegend />`), `placeholder?`, `size?`, `invalid?`, `disabled?`. Внизу — «N календарных, праздники не считаются».
- Подкраска дней:
  - `dayTone(iso) => "free" | "one" | "full" | "own" | "muted" | null` — готовые тона загрузки и своего отпуска;
  - `dayDecorator(iso) => { tone?, bg?, dot?, tooltip?, title?, disabled? } | null` — свой фон, точка под числом, строки подсказки, запрет выбора. Декоратор сильнее `dayTone`.
- **Выделение диапазона** — отдельный слой под днями (`RangeLayer` в `Calendar.tsx`): по капсуле на строку недели и круги краёв.
  Ячейки при выделении не меняют ни фон, ни радиус: их подкраска и точки внутри выделения гаснут одним классом сетки
  (`data-range-active`) тем же кадром и с тем же duration, что появляется капсула (`--dur-2`, spring). Новое выделение и сброс —
  старое гаснет на месте, новое появляется целиком (opacity + scale). Если один край на месте, а другой тянут — капсула и круг плавно едут.
  Если экран сам убирает `bg`/`dot` у выделенных дней тем же рендером, kit дорисует прежние «призраками», чтобы не было пустого кадра.
  Свой `lift` на крае выделения поднимает круг слоя. `prefers-reduced-motion` — всё мгновенно.
- **Перенос перетаскиванием** (тащит экран сам: pointer-события и `data-day` на кнопках дней), kit даёт отрисовку:
  - `rangeStyle="outline"` у `CalendarMonth` / `RangeCalendar` / `DateRangePicker` — диапазон обводкой `--vacation-strong`, края — белые кружки с обводкой
    (по умолчанию `"fill"`). Так часть, которую меняют, отличается от нового выделения;
  - в `dayDecorator`: `lift` — «поднятый» призрак (тень, scale 1.06, поверх соседей), `faded` — бледный исходный день (число 0.35, подкраска 0.55,
    обводка края не бледнеет), `ring: "css-цвет"` — обводка одного дня, `grab` — курсор «взять» на дне, который можно тащить;
  - курсор во время переноса: атрибут `data-grabbing` на любом предке сетки → `grabbing` на всех днях (правило в `globals.css`);
  - подсказка дня на время переноса: `dayTip.suspend(true)` — открытый пузырь закрывается сразу, `show` игнорируется; `dayTip.suspend(false)` по окончании.
  Пример — /kit, блок «Даты», август 2027 и переключатель «Идёт перенос».
- **Подсказка дня** — своя, не браузерная: **один тёмный пузырь со стрелкой на всю страницу** (`DayTip.tsx`). `DayTipHost` уже смонтирован
  в `app/layout.tsx`, все `CalendarMonth` (год, квартал, два месяца пикера) управляют им через `dayTip.show(ячейка, содержимое)` / `dayTip.hide()`.
  Переход в соседний месяц для пузыря — то же, что на соседний день. Первое появление через 300 мс; при открытом пузыре смена дня мгновенная;
  уход с дня прячет через 120 мс (зазоры не моргают), после этого ещё 0,5 с «тепло». Позиция не анимируется никогда — пузырь сразу встаёт
  на новое место; анимируются только появление и исчезновение (opacity, scale 0.98 → 1 от стрелки). До расчёта позиции пузырь невидим.
  Содержимое собирается само, по порядку:
  1. «11 мая 2027, вторник»;
  2. праздник («Радуница», красная точка, «праздник в отпуск не входит») или «Выходной», «Выходной по переносу рабочего дня», «Рабочий день по переносу»;
  3. `title` декоратора — строкой;
  4. `tooltip` декоратора — `ReactNode` или массив; строки-тексты получают нейтральную точку;
  5. если `tooltip` не задан, а тон есть — строка из тона («в группе осталось одно место», «ваш отпуск»…);
  6. «вне доступного периода» для дней за `min` / `max`.
  Строка с цветной точкой — `<DayTipLine tone="ok | warn | bad | info | vacation | accent | neutral">…</DayTipLine>` (или `dot="#цвет"`): цвета подобраны под тёмный пузырь.
  Пример: `dayDecorator={(d) => ({ tone: "one", tooltip: [<DayTipLine key="a" tone="warn">в группе свободно 1 место из 2</DayTipLine>, <DayTipLine key="b" tone="vacation">ваш отпуск, часть 1</DayTipLine>] })}`.
  Недоступный день (`disabled` или вне `min`/`max`) подсказку тоже показывает: у кнопки `aria-disabled`, а не `disabled`.
- Без поповера (прямо на странице): `RangeCalendar` (те же пропсы, что у `DateRangePicker`, но `onChange` получает и незавершённый диапазон `{ start, end: null }`), `DateCalendar`, `CalendarMonth` (одна сетка месяца — для годового обзора из 12 месяцев: `year`, `month` 0–11, `range?`, `onPick?`, `dayTone?`, `dayDecorator?`, `hideFootnote?`).
- `RangeSummary` — `start`, `end`: «14 дней календарных, праздники не считаются».
- `CalendarLegend` — `tones?`, `holidays?`: легенда «свободно / одно место / мест нет / ваш отпуск / праздник / выходной».

### Прочее — `Misc.tsx`
- `Skeleton` — `w?`, `h?`, `round?`. Радиус — от текущей Surface.
- `EmptyState` — `icon?`, `title`, `description?`, `action?`.
- `Avatar` — `name` (ФИО), `size?` (32). Инициалы «Имя + Фамилия», цвет устойчив для имени. `initials(name)`.
- `Divider` — волосяная линия. `Stat` — `label`, `value`, `hint?`, `tone?`: крупная цифра для сводок.
- `cx(...)` — склейка классов.
