"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowRightLeft, CalendarPlus, Check, Copy, Download, Inbox, Mail, MoreHorizontal, Pencil, Plus, Search, Send, Settings2, Trash2, Undo2,
} from "lucide-react";
import {
  Avatar, Badge, Button, ButtonRow, Card, CalendarLegend, Checkbox, DateCalendar, DatePicker, DateRangePicker, Dialog, Divider, EmptyState,
  Field, IconButton, Input, Menu, NumberStepper, PageHeader, Pill, Popover, RangeCalendar, RangeSummary, Section, SegmentedControl, Select, Sheet,
  Skeleton, Stat, Surface, Switch, Tabs, Textarea, Tooltip, toast, DayTipLine, type DateRange, type DayDecoration, type DayTone,
  CalendarMonth, dayTip,
} from "@/components/kit";

/* демо-подкраска: загрузка группы по дням и свой отпуск 7–20 июня 2027 */
const OWN = { start: "2027-06-07", end: "2027-06-20" };
function demoTone(d: string): DayTone | null {
  if (d >= OWN.start && d <= OWN.end) return "own";
  const m = +d.slice(5, 7), day = +d.slice(8, 10);
  if (m < 5 || m > 9) return null;
  const h = (day * 7 + m * 13) % 11;
  return m >= 6 && m <= 8 ? (h < 3 ? "full" : h < 6 ? "one" : "free") : h < 2 ? "one" : "free";
}
/* подсказка дня: строки из декоратора — так экраны кладут загрузку группы, свой отпуск и запреты */
function demoDecor(d: string): DayDecoration | null {
  const tone = demoTone(d);
  if (d >= OWN.start && d <= OWN.end) return { tooltip: <DayTipLine tone="vacation">ваш отпуск, часть 1 · 7–20 июня</DayTipLine> };
  if (d === "2027-07-14") return { dot: "var(--warn)", tooltip: [
    <DayTipLine key="1" tone="warn">в группе осталось 1 место из 2</DayTipLine>,
    <DayTipLine key="2" tone="neutral">в отпуске: Петров С.</DayTipLine>,
  ] };
  if (d === "2027-07-22") return { dot: "var(--bad)", disabled: true, tooltip: [
    <DayTipLine key="1" tone="bad">запрет: нет руководителя отделения на месте</DayTipLine>,
    <span key="2" className="block pl-[14px] text-[11.5px] text-white/55">Регламент: кто без кого не уходит</span>,
  ] };
  if (tone === "full") return { tooltip: <DayTipLine tone="bad">запрет: мест нет, в группе 2 из 2</DayTipLine> };
  if (tone === "one") return { tooltip: <DayTipLine tone="warn">в группе свободно 1 место из 2</DayTipLine> };
  if (tone === "free") return { tooltip: <DayTipLine tone="ok">в группе свободно 2 места из 2</DayTipLine> };
  return null;
}

const PEOPLE = [
  ["E19", "Кузьмич Марина Леонидовна", "Специалист по кадрам (HR)", "HR"],
  ["E01", "Соколов Андрей Викторович", "Исполнительный директор", "Руководители"],
  ["E04", "Гриб Виктор Андреевич", "Руководитель отделения", "Руководители"],
  ["E09", "Романович Глеб Юрьевич", "Начальник отдела", "Руководители"],
  ["E13", "Иванова Анна Сергеевна", "Менеджер по продажам", "Сотрудники"],
  ["E14", "Петров Сергей Иванович", "Менеджер по продажам", "Сотрудники"],
  ["E15", "Ковалёв Денис Олегович", "Менеджер по продажам", "Сотрудники"],
  ["E17", "Лис Наталья Петровна", "Менеджер по продажам", "Сотрудники"],
  ["E18", "Жук Татьяна Михайловна", "Бухгалтер", "Сотрудники"],
  ["E20", "Ярош Максим Игоревич", "Менеджер по продажам", "Сотрудники"],
] as const;

function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Section title={title} description={note} pad={24}>
      {children}
    </Section>
  );
}
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[140px_1fr] items-center gap-4 py-2.5">
    <div className="text-[13px] text-muted">{label}</div>
    <div className="flex flex-wrap items-center gap-2.5">{children}</div>
  </div>
);

export function KitShowcase() {
  const [seg, setSeg] = useState<"year" | "half" | "month">("half");
  const [tab, setTab] = useState<"all" | "mine" | "conflicts">("all");
  const [person, setPerson] = useState<string | null>("E13");
  const [type, setType] = useState<string | null>(null);
  const [days, setDays] = useState(14);
  const [sw1, setSw1] = useState(true);
  const [sw2, setSw2] = useState(false);
  const [cb1, setCb1] = useState(true);
  const [cb2, setCb2] = useState(false);
  const [date, setDate] = useState<string | null>("2027-03-08");
  const [range, setRange] = useState<DateRange>({ start: "2027-07-05", end: "2027-07-18" });
  const [inline, setInline] = useState<DateRange>({ start: "2027-05-03", end: "2027-05-12" });
  const [single, setSingle] = useState<string | null>("2027-05-11");
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [grabbing, setGrabbing] = useState(false);

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Набор интерфейса"
        subtitle="Примитивы @/components/kit во всех состояниях. Экраны собираются только из них; описание — kit/README.md."
        actions={<Pill tone="accent">kit · 26.10.2026</Pill>}
      />

      <Block title="Концентричность" note="Внутренний радиус = внешний − отступ. Шкала 28 → 20 → 12 → капсула; контролы берут радиус у своей поверхности сами.">
        <div className="grid md:grid-cols-[1fr_1fr] gap-8 items-center">
          <Surface level="inset" tone="tinted" className="max-w-[440px]">
            <Surface nested pad={8} tone="raised" className="shadow-1">
              <div className="flex items-center gap-2">
                <Button variant="primary" block>Кнопка 12</Button>
                <SegmentedControl size="md" value="a" onChange={() => {}} options={[{ value: "a", label: "9" }, { value: "b", label: "ползунок" }]} />
              </div>
              <div className="px-2 pt-3 pb-1 text-[12.5px] text-muted">Панель 28 → отступ 8 → блок 20 → отступ 8 → кнопка 12 → отступ 3 → ползунок 9</div>
            </Surface>
          </Surface>
          <div className="flex flex-col gap-3 text-[13.5px]">
            {[["--r-panel", "28", "карточка, окно, панель"], ["--r-block", "20", "блок в панели, поповер, меню"], ["--r-control", "12", "кнопка, поле, сегменты"], ["--r-thumb", "9", "ползунок сегментов"], ["--r-pill", "∞", "пилюли, аватары, навигация"]].map(([t, v, d]) => (
              <div key={t} className="flex items-center gap-3">
                <span className="w-10 h-10 bg-accent-bg shrink-0" style={{ borderRadius: v === "∞" ? 999 : +v / 1.4 }} />
                <code className="text-[12.5px] text-text-2 w-[92px]">{t}</code>
                <span className="font-semibold tnum w-6">{v}</span>
                <span className="text-muted">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </Block>

      <Block title="Кнопки">
        {(["primary", "secondary", "tinted", "ghost", "destructive"] as const).map((v) => (
          <Row key={v} label={v}>
            <Button variant={v} size="sm">Маленькая</Button>
            <Button variant={v} icon={v === "destructive" ? Trash2 : v === "primary" ? Send : Plus}>
              {v === "destructive" ? "Удалить часть" : v === "primary" ? "Отправить на согласование" : "Добавить часть"}
            </Button>
            <Button variant={v} size="lg">Крупная</Button>
            <Button variant={v} loading>Сохраняю</Button>
            <Button variant={v} disabled>Недоступна</Button>
          </Row>
        ))}
        <Divider className="my-2" />
        <Row label="Капсула, на всю ширину">
          <Button variant="primary" pill icon={Check}>Согласовать</Button>
          <Button variant="secondary" pill icon={Undo2}>Вернуть</Button>
          <div className="w-[260px]"><Button variant="tinted" block icon={CalendarPlus}>На всю ширину</Button></div>
        </Row>
        <Row label="IconButton">
          <IconButton icon={Pencil} label="Изменить" />
          <IconButton icon={Copy} label="Копировать" variant="secondary" />
          <IconButton icon={Plus} label="Добавить" variant="tinted" />
          <IconButton icon={Send} label="Отправить" variant="primary" />
          <IconButton icon={Trash2} label="Удалить" variant="destructive" />
          <IconButton icon={Settings2} label="Настройки" variant="secondary" round={false} />
          <IconButton icon={Download} label="Скачать" size="sm" variant="secondary" />
          <IconButton icon={Mail} label="Письмо" size="lg" variant="secondary" />
          <IconButton icon={Send} label="Отправка" loading variant="tinted" />
        </Row>
      </Block>

      <Block title="Пилюли и бейджи" note="Тонированный фон и насыщенный текст. Точка — для статуса в строке. Мятный — действия и выбор, зелёный — «согласовано», синий — свой отпуск.">
        <Row label="С точкой">
          <Pill tone="ok" dot>Согласована</Pill><Pill tone="warn" dot>На согласовании</Pill><Pill tone="bad" dot>Конфликт</Pill>
          <Pill tone="info" dot>Возвращена</Pill><Pill tone="neutral" dot>Черновик</Pill><Pill tone="vacation" dot>Ваш отпуск</Pill>
        </Row>
        <Row label="Без точки, с иконкой">
          <Pill tone="ok" icon={Check}>проходит</Pill><Pill tone="warn">лето 16 из 14</Pill><Pill tone="bad">3 МПП из 2</Pill>
          <Pill tone="info">исключение HR</Pill><Pill tone="neutral">ст. 168 ТК</Pill><Pill tone="accent">новое</Pill><Pill tone="vacation">14 дней</Pill>
        </Row>
        <Row label="Три зелёно-синих смысла">
          <Button variant="primary" size="sm">Действие — мятный</Button>
          <Pill tone="ok" dot>Согласована — зелёный</Pill>
          <Pill tone="vacation" dot>Свой отпуск — синий</Pill>
        </Row>
        <Row label="Маленькие, бейджи">
          <Pill size="sm" tone="ok">ok</Pill><Pill size="sm" tone="warn">warn</Pill><Pill size="sm" tone="bad">bad</Pill><Pill size="sm" tone="info">info</Pill>
          <Badge>3</Badge><Badge tone="bad">12</Badge><Badge tone="neutral">128</Badge>
        </Row>
      </Block>

      <Block title="Сегменты и вкладки">
        <Row label="SegmentedControl">
          <SegmentedControl aria-label="Масштаб" value={seg} onChange={setSeg} options={[{ value: "year", label: "Год" }, { value: "half", label: "Полугодие" }, { value: "month", label: "Месяц" }]} />
          <SegmentedControl size="sm" value={seg} onChange={setSeg} options={[{ value: "year", label: "Год" }, { value: "half", label: "Полугодие" }, { value: "month", label: "Месяц", disabled: true }]} />
        </Row>
        <Row label="Tabs">
          <div className="w-full">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: "all", label: "Все заявки", count: 38 }, { value: "mine", label: "Ждут меня", count: 4 }, { value: "conflicts", label: "Конфликты", count: 3 }]} />
            <div className="pt-4 text-[13.5px] text-muted">Выбрано: {tab}</div>
          </div>
        </Row>
      </Block>

      <Block title="Поля">
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <Field label="Обычное" hint="Подсказка под полем"><Input placeholder="Например, Иванова" /></Field>
          <Field label="С иконкой"><Input icon={Search} placeholder="Поиск сотрудника" /></Field>
          <Field label="Ошибка" error="Конец раньше начала"><Input invalid defaultValue="31.06.2027" /></Field>
          <Field label="Недоступно"><Input disabled defaultValue="Согласовано, менять нельзя" /></Field>
          <Field label="Крупное, с единицами"><Input size="lg" defaultValue="24" trailing="дней" /></Field>
          <Field label="Число"><NumberStepper aria-label="Лимит" value={days} onChange={setDays} min={1} max={30} suffix="дней" /></Field>
          <Field label="Комментарий" className="md:col-span-2"><Textarea placeholder="Почему возвращаете заявку — сотрудник увидит этот текст" /></Field>
        </div>
        <Divider className="my-5" />
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
          <Switch checked={sw1} onChange={setSw1} label="Правило включено" description="Проверка пересчитается сразу" />
          <Switch checked={sw2} onChange={setSw2} label="Льготникам по ч. 4 ст. 168" description="Применять к льготникам" />
          <Checkbox checked={cb1} onChange={setCb1} label="Ознакомлен с регламентом" description="ст. 54–55 ТК" />
          <Checkbox checked={cb2} onChange={setCb2} indeterminate={!cb2} label="Выбрать всех (частично)" />
          <Switch checked={false} onChange={() => {}} disabled label="Недоступный переключатель" />
          <Checkbox checked onChange={() => {}} disabled label="Недоступная галочка" />
        </div>
      </Block>

      <Block title="Выпадающие окна" note="Свой listbox и меню: стрелки, Enter, Esc, ввод букв; поиск при длинном списке; переворот у края экрана.">
        <div className="grid md:grid-cols-3 gap-x-8 gap-y-5 items-end">
          <Field label="Select — короткий">
            <Select value={type} onChange={setType} placeholder="Тип отпуска" options={[
              { value: "main", label: "Основной" }, { value: "u190", label: "Без сохранения, ст. 190" }, { value: "u189", label: "Без сохранения, ст. 189", description: "Отказать нельзя" },
            ]} />
          </Field>
          <Field label="Select — группы, поиск, аватары">
            <Select value={person} onChange={setPerson} menuWidth={340} options={PEOPLE.map(([id, n, pos, g]) => ({
              value: id, label: n, description: pos, group: g, leading: <Avatar name={n} size={26} />,
            }))} />
          </Field>
          <Field label="Select — маленький, ошибка">
            <Select size="sm" invalid value={null} onChange={() => {}} placeholder="Не выбрано" options={[{ value: "a", label: "Отдел оптовых продаж" }, { value: "b", label: "Склад", disabled: true }]} />
          </Field>
        </div>
        <Divider className="my-5" />
        <ButtonRow>
          <Menu items={[
            { heading: "Часть 1 · 7–20 июня" },
            { label: "Изменить даты", icon: Pencil, onSelect: () => toast("Изменить даты") },
            { label: "Перенести", icon: ArrowRightLeft, onSelect: () => toast("Перенос", { tone: "info" }), hint: "за 14 дн." },
            { label: "Скопировать", icon: Copy, onSelect: () => toast("Скопировано"), disabled: true },
            { separator: true },
            { label: "Удалить часть", icon: Trash2, destructive: true, onSelect: () => toast("Часть удалена", { tone: "bad" }) },
          ]}>
            <Button icon={MoreHorizontal}>Menu</Button>
          </Menu>
          <Popover width={300} content={(close) => (
            <div className="flex flex-col gap-3">
              <div className="text-[15px] font-semibold tracking-[-0.015em]">Почему нельзя</div>
              <p className="text-[13.5px] text-muted leading-snug">7–20 июня уже в отпуске Петров и Ковалёв, лимит группы «Менеджеры по продажам» — 2 человека.</p>
              <Button variant="tinted" block onClick={close}>Понятно</Button>
            </div>
          )}>
            <Button>Popover</Button>
          </Popover>
          <Tooltip content="8 марта — День женщин. Праздник в отпуск не входит.">
            <Button variant="ghost">Tooltip (наведите)</Button>
          </Tooltip>
          <IconButton icon={Trash2} label="IconButton: подсказка из label" variant="secondary" />
          <Pill tone="warn" title="Летом 16 дней при лимите 14 (регламент: летний период)">Pill с подсказкой</Pill>
        </ButtonRow>
      </Block>

      <Block title="Окна и уведомления">
        <ButtonRow>
          <Button variant="secondary" onClick={() => setDialog(true)}>Dialog</Button>
          <Button variant="secondary" onClick={() => setSheet(true)}>Sheet справа</Button>
          <Button variant="tinted" onClick={() => toast("План сохранён", { description: "Черновик виден только вам" })}>Toast ok</Button>
          <Button variant="tinted" onClick={() => toast("Есть замечания", { tone: "warn", description: "Летом 16 дней при лимите 14" })}>Toast warn</Button>
          <Button variant="tinted" onClick={() => toast("Не отправлено", { tone: "bad", description: "Три МПП одновременно" })}>Toast bad</Button>
          <Button variant="tinted" onClick={() => toast("Часть удалена", { tone: "info", action: { label: "Вернуть", onClick: () => toast("Восстановлено") } })}>С действием</Button>
        </ButtonRow>
        <Dialog open={dialog} onClose={() => setDialog(false)} title="Вернуть заявку?" description="Иванова Анна получит комментарий и сможет поменять даты."
          footer={<>
            <Button onClick={() => setDialog(false)}>Отмена</Button>
            <Button variant="primary" loading={saving} onClick={() => { setSaving(true); setTimeout(() => { setSaving(false); setDialog(false); toast("Заявка возвращена"); }, 900); }}>Вернуть</Button>
          </>}>
          <Field label="Комментарий"><Textarea defaultValue="7–20 июня уже уходят Петров и Ковалёв. Сдвиньте, пожалуйста, на неделю." /></Field>
        </Dialog>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Иванова Анна" description="Менеджер по продажам · отдел оптовых продаж"
          footer={<><Button variant="secondary" block icon={Undo2} onClick={() => setSheet(false)}>Вернуть</Button><Button variant="primary" block icon={Check} onClick={() => setSheet(false)}>Согласовать</Button></>}>
          <div className="flex flex-col gap-4">
            <Surface nested pad={14} tone="flat">
              <div className="flex items-center justify-between"><span className="font-medium">Часть 1</span><Pill tone="bad" dot>Конфликт</Pill></div>
              <div className="text-[13.5px] text-muted mt-1">7–20 июня · 14 дней</div>
            </Surface>
            <p className="text-[14px] text-text-2 leading-relaxed">Панель — остров с отступом 8 от края экрана. Кнопки внизу концентричны: 28 − 16 = 12.</p>
          </div>
        </Sheet>
      </Block>

      <Block title="Даты" note="Свои пикеры: выходные и праздники РБ красным, праздник подчёркнут. Наведите на день: подсказка с датой, днём недели, праздником или выходным и строками из dayDecorator.tooltip. Соседний день — без задержки. 22 июля недоступен, но подсказку показывает.">
        <div className="grid md:grid-cols-3 gap-x-8 gap-y-5 items-end">
          <Field label="DatePicker"><DatePicker value={date} onChange={setDate} min="2027-01-01" max="2027-12-31" /></Field>
          <Field label="DateRangePicker с загрузкой группы" hint="Откройте: июнь–август подкрашены, ваш отпуск — синий">
            <DateRangePicker value={range} onChange={setRange} min="2027-01-01" max="2027-12-31" dayTone={demoTone} dayDecorator={demoDecor}
              footnote={<CalendarLegend />} />
          </Field>
          <Field label="Пустой, недоступный"><DateRangePicker value={{ start: null, end: null }} onChange={() => {}} disabled /></Field>
        </div>
        <Divider className="my-6" />
        <div className="flex flex-wrap gap-10">
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-muted">RangeCalendar на странице · май 2027: 1, 9, 11 — праздники, 8 — рабочая суббота, 10 — выходной по переносу</div>
            <RangeCalendar value={inline} onChange={setInline} min="2027-01-01" max="2027-12-31" dayTone={demoTone} dayDecorator={demoDecor} />
            <div className="text-[13.5px]"><RangeSummary start={inline.start} end={inline.end} /></div>
            <CalendarLegend />
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-muted">DateCalendar</div>
            <DateCalendar value={single} onChange={setSingle} />
          </div>
          <div className="flex flex-col gap-3" data-grabbing={grabbing || undefined}>
            <div className="text-[13px] text-muted max-w-[280px]">Перенос части: старая часть обводкой (rangeStyle=&quot;outline&quot;), исходные дни бледные (faded), призрак поднят (lift), обводка дня (ring), курсор grab / data-grabbing</div>
            <CalendarMonth year={2027} month={7} range={{ start: "2027-08-02", end: "2027-08-08" }} rangeStyle="outline"
              dayDecorator={(d) => d >= "2027-08-02" && d <= "2027-08-08" ? { faded: true, grab: true }
                : d >= "2027-08-16" && d <= "2027-08-22" ? { lift: true, bg: "var(--vacation-bg)", tooltip: <DayTipLine tone="vacation">сюда переносится часть 2</DayTipLine> }
                : d === "2027-08-27" ? { ring: "var(--warn)", tooltip: <DayTipLine tone="warn">ring: обводка одного дня</DayTipLine> } : null} />
            <Switch checked={grabbing} onChange={(v) => { setGrabbing(v); dayTip.suspend(v); }} label="Идёт перенос" description="data-grabbing и dayTip.suspend(true)" />
          </div>
        </div>
      </Block>

      <Block title="Состояния и прочее">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-muted">Skeleton</div>
            <div className="flex items-center gap-3"><Skeleton round w={40} h={40} /><div className="flex-1 flex flex-col gap-2"><Skeleton h={14} w="70%" /><Skeleton h={12} w="45%" /></div></div>
            <Skeleton h={88} />
          </div>
          <Card pad={8} tone="flat" className="!bg-surface-alt">
            <EmptyState icon={Inbox} title="Новых заявок нет" description="Всё, что вы согласовали, уже у HR." action={<Button variant="tinted" size="sm">Открыть график</Button>} />
          </Card>
          <div className="flex flex-col gap-4">
            <div className="text-[13px] text-muted">Avatar, Stat</div>
            <div className="flex -space-x-2">{PEOPLE.slice(0, 6).map(([id, n]) => <Avatar key={id} name={n} size={36} className="ring-2 ring-white" />)}</div>
            <div className="grid grid-cols-2 gap-4"><Stat label="Подали план" value="19 из 20" hint="95%" /><Stat label="Конфликты" value={3} tone="bad" /></div>
          </div>
        </div>
      </Block>
    </div>
  );
}
