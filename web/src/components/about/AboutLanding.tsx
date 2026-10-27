import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight, Ban, Check, ChevronRight, CircleCheck, Cloud, Database, ExternalLink, Handshake, History, Info, Layers,
  Lock, Plug, Printer, Send, Server, ShieldCheck, Smartphone, Sparkles, Stamp, TriangleAlert, User, Users, type LucideIcon,
} from "lucide-react";
import { Pill, Surface } from "@/components/kit";
import { SubNav } from "./SubNav";
import { Decisions } from "./Decisions";
import { Questions } from "./Questions";
import {
  ABBR, ALT_CRITERIA, ALTERNATIVES, BEFORE_AFTER, CONFLICTS, DEPLOY, FUTURE, LEVELS, PROD_GAP, ROADMAP, ROUTE, RULES, STACK_LINE, TESTS, type Mark,
} from "./content";

const NAV = [
  { id: "how", label: "Как работает" },
  { id: "auto", label: "Было и стало" },
  { id: "tech", label: "Устройство" },
  { id: "prod", label: "До запуска" },
  { id: "alt", label: "Альтернативы" },
  { id: "decisions", label: "Решения" },
  { id: "risks", label: "Регламент и ТК" },
  { id: "questions", label: "Вопросы" },
  { id: "roadmap", label: "Развитие" },
  { id: "cost", label: "Стоимость" },
];

/** Мини-лендинг о решении для проверяющих: серверная разметка, интерактив — в SubNav, Decisions, Questions. */
export function AboutLanding() {
  return (
    <div className="pb-8">
      <Hero />
      <SubNav items={NAV} className="mt-14 sm:mt-20" />
      <How />
      <Automated />
      <Tech />
      <ProdGap />
      <Alternatives />
      <Block id="decisions" kicker="Решения и допущения" title="На что опирался"
        lead="Где ни регламент, ни ТК ответа не давали, решал сам. Такие места помечены как допущения.">
        <Decisions />
      </Block>
      <Risks />
      <Block id="questions" kicker="Вопросы к компании" title="Что хочу уточнить на встрече"
        lead="Ответы поменяют настройки, а не устройство системы.">
        <Questions />
        <Abbreviations />
      </Block>
      <Roadmap />
      <Cost />
      <Outro />
    </div>
  );
}

/* ——— каркас ——— */

/** Тире не начинает строку: пробел перед ним неразрывный. */
const nb = (t: string) => t.replace(/ —/g, " —");

function Block({ id, kicker, title, lead, children }: { id: string; kicker: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} className="pt-20 sm:pt-28" style={{ scrollMarginTop: "calc(var(--header-h) + 40px)" }}>
      <div className="max-w-[760px] mb-8 sm:mb-10">
        <div className="text-[15px] font-semibold text-accent-strong tracking-[-0.01em]">{kicker}</div>
        <h2 className="mt-2 text-[clamp(30px,4.2vw,48px)] font-semibold tracking-[-0.035em] leading-[1.06] text-balance">{nb(title)}</h2>
        {lead && <p className="mt-4 text-[clamp(16px,1.6vw,19px)] leading-[1.5] text-muted text-pretty">{nb(lead)}</p>}
      </div>
      {children}
    </section>
  );
}

function Glyph({ icon: Icon, tone = "accent", size = 40 }: { icon: LucideIcon; tone?: "accent" | "ok" | "warn" | "bad" | "info" | "dark"; size?: number }) {
  const cls = {
    accent: "bg-accent-bg text-accent-strong", ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn",
    bad: "bg-bad-bg text-bad", info: "bg-info-bg text-info", dark: "bg-text text-white",
  }[tone];
  return (
    <span className={`shrink-0 grid place-items-center rounded-full ${cls}`} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  );
}

const btn = "inline-flex items-center gap-2 h-11 px-5 rounded-full text-[15px] font-medium tracking-[-0.01em] press";

/* ——— Hero ——— */

function Hero() {
  return (
    <section className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-12 lg:gap-14 items-center pt-6 sm:pt-12">
      <div>
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/avistrade-mark.svg" alt="" width={28} height={28} />
          <span className="text-[15px] font-medium text-muted">Отпуска 2027 · прототип для ООО «Авистрейд»</span>
        </div>
        <h1 className="mt-6 text-[clamp(40px,6.2vw,76px)] font-semibold tracking-[-0.045em] leading-[0.98] text-balance">
          Отпуска без&nbsp;бумаги и&nbsp;ручных сверок
        </h1>
        <div className="mt-8 grid sm:grid-cols-2 gap-5 max-w-[640px]">
          <div>
            <div className="text-[13px] font-semibold text-muted">Задача</div>
            <p className="mt-1.5 text-[17px] leading-[1.45] text-pretty">
              Собрать пожелания по отпускам, проверить их по регламенту и ТК РБ и согласовать. Правилами и исключениями управляет HR.
            </p>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-accent-strong">Решение</div>
            <p className="mt-1.5 text-[17px] leading-[1.45] text-pretty">
              Сотрудник выбирает даты в календаре и сразу видит, подходят ли они. Заявка сама доходит до руководителя и РО1.
            </p>
          </div>
        </div>
        <div className="mt-9 flex flex-wrap gap-2.5">
          <Link href="/me" className={`${btn} bg-accent-strong text-white hover:bg-[var(--accent-hover)]`}>
            Открыть прототип <ArrowRight size={17} strokeWidth={2.25} />
          </Link>
          <a href="#questions" className={`${btn} bg-fill-2 text-text hover:bg-fill`}>Вопросы к компании</a>
        </div>
        <p className="mt-6 text-[14px] text-muted">Прототип собрал примерно за 6 часов. В работе использовал Claude Code.</p>
      </div>
      <HeroMock />
    </section>
  );
}

/**
 * Картинка героя — как выглядит проверка в «Мой отпуск» на сюжете демо (Иванова, 14–20 июня).
 * Концентричность: inset 28 − 8 = 20 у всех блоков и у кнопки, между блоками те же 8.
 */
function HeroMock() {
  const rows: { tone: "ok" | "warn"; title: string; text: string }[] = [
    { tone: "warn", title: "Лимит группы", text: "В группе уже 2 из 2 — нужно исключение" },
    { tone: "ok", title: "Норма дней", text: "7 из 24 дней" },
    { tone: "ok", title: "Кто замещает", text: "Указан, на месте" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-[440px]">
      <div aria-hidden className="absolute -inset-8 rounded-[48px] bg-[radial-gradient(60%_60%_at_60%_40%,var(--accent-bg),transparent_70%)]" />
      <Surface level="inset" className="relative shadow-3 flex flex-col gap-2">
        <Surface nested pad={16} tone="raised" className="!shadow-none">
          <div className="text-[12.5px] font-medium text-muted">Новый отпуск</div>
          <div className="mt-0.5 flex items-center justify-between gap-3">
            <span className="text-[24px] leading-[1.15] font-semibold tracking-[-0.03em] tnum">14–20 июня</span>
            <Pill tone="vacation">7 дней</Pill>
          </div>
          <MiniWeek />
        </Surface>
        {rows.map((r) => (
          <Surface key={r.title} nested pad={16} className="flex items-center gap-3">
            <Glyph icon={r.tone === "ok" ? Check : TriangleAlert} tone={r.tone} size={32} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] leading-[1.3] font-semibold tracking-[-0.01em]">{r.title}</div>
              <div className="text-[13px] leading-[1.35] text-muted">{r.text}</div>
            </div>
            {r.tone === "warn" && <Pill tone="warn" size="sm" className="shrink-0">решает РО1</Pill>}
          </Surface>
        ))}
        <div className="h-12 bg-accent-strong text-white text-[15px] font-medium grid place-items-center" style={{ borderRadius: "var(--r-in)" }}>
          Отправить с обоснованием
        </div>
      </Surface>
    </div>
  );
}

/** Две недели июня 2027 с выделением 14–20 (пн–вс): полоса от центра первого дня до центра последнего, выходные красным. */
function MiniWeek() {
  const days = Array.from({ length: 14 }, (_, i) => 7 + i);
  return (
    <div className="mt-4 grid grid-cols-7 gap-y-1 text-center text-[13px] tnum">
      {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d, i) => (
        <span key={d} className={`pb-1 text-[11px] font-medium ${i > 4 ? "text-weekend" : "text-muted-2"}`}>{d}</span>
      ))}
      {days.map((d) => {
        const sel = d >= 14 && d <= 20, edge = d === 14 || d === 20, weekend = (d - 7) % 7 > 4;
        return (
          <span key={d} className="relative h-9 grid place-items-center">
            {sel && (
              <span aria-hidden className="absolute top-0.5 bottom-0.5 bg-vacation-bg"
                style={{ left: d === 14 ? "50%" : 0, right: d === 20 ? "50%" : 0 }} />
            )}
            <span className={`relative w-8 h-8 grid place-items-center rounded-full ${edge ? "bg-vacation text-white font-semibold" : weekend ? "text-weekend" : ""}`}>{d}</span>
          </span>
        );
      })}
    </div>
  );
}

/* ——— Как работает ——— */

const ROUTE_ICONS: LucideIcon[] = [User, Users, ShieldCheck, Stamp];

function How() {
  return (
    <Block id="how" kicker="Как работает" title="От пожелания до утверждённого графика"
      lead="Маршрут взят из регламента и ст. 168 ТК.">
      <Surface level="panel" pad={24} className="sm:!p-8">
        <ol className="grid lg:grid-cols-4 gap-0 lg:gap-4">
          {ROUTE.map((s, i) => {
            const Icon = ROUTE_ICONS[i];
            return (
              <li key={s.who} className="relative flex lg:flex-col gap-4 lg:gap-0 pb-7 lg:pb-0">
                {/* соединительная линия: на телефоне вертикальная, на широком — горизонтальная */}
                {i < ROUTE.length - 1 && (
                  <>
                    <span aria-hidden className="lg:hidden absolute left-[23px] top-12 bottom-1 w-[2px] rounded-full bg-[linear-gradient(var(--accent),var(--accent-bg))]" />
                    <span aria-hidden className="hidden lg:block absolute top-[23px] left-14 right-0 h-[2px] rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-bg))]" />
                    <span aria-hidden className="hidden lg:grid absolute top-[13px] -right-[13px] w-[22px] h-[22px] rounded-full bg-surface shadow-1 place-items-center text-accent-strong z-10">
                      <ChevronRight size={14} strokeWidth={2.5} />
                    </span>
                  </>
                )}
                <span className="relative z-[1] shrink-0 w-12 h-12 rounded-full bg-accent-strong text-white grid place-items-center shadow-[0_0_0_6px_var(--surface)]">
                  <Icon size={22} strokeWidth={2} />
                </span>
                <div className="lg:mt-5 lg:pr-6 min-w-0">
                  <div className="text-[13px] font-medium text-muted tnum">Шаг {i + 1}</div>
                  <div className="mt-0.5 text-[21px] font-semibold tracking-[-0.025em]">{s.who}</div>
                  <Pill tone="neutral" size="sm" className="mt-2">экран «{s.screen}»</Pill>
                  <p className="mt-2.5 text-[14.5px] leading-[1.5] text-text-2">{s.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 lg:mt-8 flex items-center gap-3 rounded-[12px] bg-ok-bg px-4 py-3">
          <CircleCheck size={20} strokeWidth={2.25} className="text-ok shrink-0" />
          <span className="text-[14.5px] leading-[1.45]">
            Утверждённый график видят все. Дальше даты меняются только переносом.
          </span>
        </div>
      </Surface>

      <h3 className="mt-14 text-[clamp(22px,2.4vw,28px)] font-semibold tracking-[-0.03em]">Что видит сотрудник при проверке</h3>
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        {LEVELS.map((l) => (
          <Surface key={l.title} level="panel" pad={24}>
            <Glyph icon={l.tone === "bad" ? Ban : l.tone === "warn" ? TriangleAlert : Info} tone={l.tone} size={44} />
            <div className="mt-4 text-[20px] font-semibold tracking-[-0.025em]">{l.title}</div>
            <p className="mt-1.5 text-[14.5px] leading-[1.5] text-text-2">{l.lead}</p>
            {l.items.length > 0 && <ul className="mt-4 flex flex-col gap-2 text-[14px] text-muted">
              {l.items.map((it) => (
                <li key={it} className="flex gap-2.5 items-baseline">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-2px] ${l.tone === "bad" ? "bg-bad" : l.tone === "warn" ? "bg-warn" : "bg-info"}`} />
                  {it}
                </li>
              ))}
            </ul>}
          </Surface>
        ))}
      </div>
    </Block>
  );
}

/* ——— Было → стало ——— */

function Automated() {
  return (
    <Block id="auto" kicker="Было и стало" title="Сверку больше не делают руками">
      <Surface level="inset">
        <div className="hidden md:grid grid-cols-[minmax(0,0.85fr)_40px_minmax(0,1.15fr)] gap-x-4 px-5 pt-3 pb-2 text-[13px] font-semibold">
          <span className="text-muted">Было</span><span /><span className="text-accent-strong">Стало</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {BEFORE_AFTER.map((r) => (
            <Surface key={r.before} nested pad={18}
              className="grid md:grid-cols-[minmax(0,0.85fr)_40px_minmax(0,1.15fr)] gap-x-4 gap-y-2 md:items-center">
              <span className="text-[15px] leading-[1.45] text-muted">{r.before}</span>
              <span aria-hidden className="hidden md:grid w-8 h-8 rounded-full bg-surface shadow-1 place-items-center text-muted-2">
                <ArrowRight size={15} strokeWidth={2.25} />
              </span>
              <span className="flex gap-2.5 items-start text-[15px] leading-[1.45] font-medium">
                <Check size={18} strokeWidth={2.5} className="text-accent-strong shrink-0 mt-[2px]" />
                {r.after}
              </span>
            </Surface>
          ))}
        </div>
      </Surface>
    </Block>
  );
}

/* ——— Технологии ——— */

function Tech() {
  return (
    <Block id="tech" kicker="Устройство" title="Как устроено внутри">
      <div className="grid lg:grid-cols-3 gap-4">
        <Surface level="panel" pad={28} className="lg:col-span-2 lg:row-span-2 flex flex-col text-white shadow-3" style={{ background: "var(--text)" }}>
          <Glyph icon={Layers} tone="accent" size={44} />
          <div className="mt-5 text-[clamp(22px,2.4vw,28px)] font-semibold tracking-[-0.03em] leading-[1.15]">
            Правила — отдельно от экранов
          </div>
          <p className="mt-3 text-[15.5px] leading-[1.55] text-white/70 max-w-[560px]">
            Каждое правило — со ссылкой на пункт регламента или статью ТК. Одна и та же проверка работает в календаре, пока
            сотрудник выбирает даты, и при отправке заявки. Строгость правил HR меняет сам.
          </p>
          <div className="mt-8 lg:mt-auto lg:pt-8 grid grid-cols-2 gap-4 max-w-[380px]">
            <Big n={RULES} label="правил регламента и ТК" />
            <Big n={TESTS.total} label="автотестов проходят" />
          </div>
        </Surface>
        <TechCard icon={History} title="Журнал"
          text="Любое изменение записывается: кто, когда, что было и что стало." />
        <TechCard icon={Lock} title="Персональные данные"
          text="Данные сотрудников — персональные (Закон № 99-З). Поэтому система работает на сервере в Беларуси или на вашем сервере, данные не уходят за границу. В прототипе — вымышленные люди." />
      </div>
      <p className="mt-4 text-[12.5px] text-muted-2">{STACK_LINE}</p>
    </Block>
  );
}

function Big({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-[clamp(34px,4vw,48px)] font-semibold tracking-[-0.04em] leading-none tnum text-accent">{n}</div>
      <div className="mt-2 text-[13px] leading-[1.35] text-white/60">{label}</div>
    </div>
  );
}

function TechCard({ icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <Surface level="panel" pad={24}>
      <Glyph icon={icon} size={44} />
      <div className="mt-4 text-[19px] font-semibold tracking-[-0.025em]">{title}</div>
      <p className="mt-1.5 text-[14.5px] leading-[1.5] text-text-2">{text}</p>
    </Surface>
  );
}

/* ——— Противоречия ——— */

function Risks() {
  return (
    <Block id="risks" kicker="Регламент и ТК" title="Три пункта регламента расходятся с ТК"
      lead="В системе они работают как написано, с пометкой «юридический риск». HR может их выключить.">
      <div className="flex flex-col gap-4">
        {CONFLICTS.map((c) => (
          <Surface key={c.reg} level="inset">
            <div className="grid md:grid-cols-3 gap-1.5">
              <Cell label="Регламент" tone="accent">{c.reg}</Cell>
              <Cell label="ТК РБ" tone="info">{c.law}</Cell>
              <Cell label="В системе" tone="warn" pill>{c.app}</Cell>
            </div>
          </Surface>
        ))}
      </div>
      <p className="mt-5 text-[14.5px] leading-[1.55] text-muted max-w-[820px]">
        Остальные ограничения регламента законны, но льготникам по ч. 4 ст. 168 уступают.
      </p>
    </Block>
  );
}

function Cell({ label, tone, pill, children }: { label: string; tone: "accent" | "info" | "warn"; pill?: boolean; children: ReactNode }) {
  const color = { accent: "text-accent-strong", info: "text-info", warn: "text-warn" }[tone];
  return (
    <Surface nested pad={18}>
      <div className="flex items-center gap-2">
        <span className={`text-[12.5px] font-semibold ${color}`}>{label}</span>
        {pill && <Pill tone="warn" size="sm">юридический риск</Pill>}
      </div>
      <p className="mt-1.5 text-[14.5px] leading-[1.5]">{children}</p>
    </Surface>
  );
}

/* ——— Сокращения ——— */

function Abbreviations() {
  return (
    <div className="mt-12">
      <h3 className="text-[clamp(22px,2.4vw,28px)] font-semibold tracking-[-0.03em]">Как я понял сокращения</h3>
      <Surface level="inset" className="mt-6">
        <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {ABBR.map((a) => (
            <Surface key={a.abbr} nested pad={18}>
              <dt className="text-[18px] font-semibold tracking-[-0.02em]">{a.abbr}</dt>
              <dd className="mt-1 text-[14px] leading-[1.45] text-text-2">{a.guess}</dd>
            </Surface>
          ))}
        </dl>
      </Surface>
    </div>
  );
}

/* ——— Дорожная карта ——— */

const ROAD_ICONS: Record<(typeof ROADMAP)[number]["icon"], LucideIcon> = {
  plug: Plug, phone: Smartphone, handshake: Handshake, send: Send, printer: Printer, sparkles: Sparkles, layers: Database,
};

function Roadmap() {
  return (
    <Block id="roadmap" kicker="Дальнейшее развитие" title="Как вырастить прототип в систему"
      lead="Порядок можно менять: что важнее, решим вместе.">
      <ol className="relative flex flex-col gap-6">
        {/* ось карты: на телефоне слева, на широком — по центру */}
        <span aria-hidden className="absolute top-6 bottom-6 left-[21px] md:left-1/2 md:-translate-x-1/2 w-[2px] rounded-full bg-[linear-gradient(var(--accent),var(--accent-bg))]" />
        {ROADMAP.map((r, i) => {
          const left = i % 2 === 0;
          const Icon = ROAD_ICONS[r.icon];
          return (
            <li key={r.stage}
              className={`relative grid grid-cols-[44px_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] gap-x-4 md:gap-x-0`}>
              <span className="col-start-1 row-start-1 md:col-start-2 justify-self-center mt-0.5 relative z-[1] w-11 h-11 rounded-full bg-accent-strong text-white grid place-items-center shadow-[0_0_0_6px_var(--bg)]">
                <Icon size={20} strokeWidth={2} />
              </span>
              <Surface level="panel" pad={24} className={`col-start-2 row-start-1 ${left ? "md:col-start-1" : "md:col-start-3"}`}>
                <div className="text-[13px] font-medium text-muted tnum">Этап {i + 1}</div>
                <div className="mt-0.5 text-[21px] font-semibold tracking-[-0.025em]">{r.stage}</div>
                {"note" in r && <div className="text-[13.5px] text-muted">{r.note}</div>}
                <ul className="mt-4 flex flex-col gap-2.5">
                  {r.items.map((it) => (
                    <li key={it} className="flex gap-2.5 items-start text-[14.5px] leading-[1.45] text-text-2">
                      <Check size={16} strokeWidth={2.5} className="text-accent-strong shrink-0 mt-[3px]" />
                      {it}
                    </li>
                  ))}
                </ul>
              </Surface>
            </li>
          );
        })}
      </ol>
      <Future className="mt-10" />
    </Block>
  );
}

/** Плюс выбранного решения: на ту же основу встают другие кадровые процессы. */
function Future({ className = "" }: { className?: string }) {
  return (
    <Surface level="panel" pad={28} className={`text-white flex flex-col md:flex-row md:items-center gap-5 md:gap-8 ${className}`} style={{ background: "var(--text)" }}>
      <div className="md:w-[42%] shrink-0">
        <div className="flex items-center gap-3">
          <Glyph icon={Layers} size={40} />
          <div className="text-[clamp(20px,2vw,24px)] font-semibold tracking-[-0.03em] leading-[1.15]">Запас на будущее</div>
        </div>
        <p className="mt-3 text-[15px] leading-[1.55] text-white/70">
          На ту же основу — правила, маршрут, журнал — можно поставить и другие кадровые процессы:
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FUTURE.map((f) => (
          <span key={f} className="h-8 px-3 inline-flex items-center rounded-full bg-white/10 text-[13.5px] font-medium">{f}</span>
        ))}
      </div>
    </Surface>
  );
}

/* ——— Прототип и боевая версия ——— */

function ProdGap() {
  return (
    <Block id="prod" kicker="Прототип и рабочая версия" title="Чего не хватает до запуска">
      <Surface level="inset">
        <div className="hidden md:grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 px-5 pt-3 pb-2 text-[13px] font-semibold">
          <span /><span className="text-muted">Сейчас</span><span className="text-accent-strong">Для работы</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {PROD_GAP.map((r) => (
            <Surface key={r.area} nested pad={18} className="grid md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2">
              <span className="text-[15px] font-semibold tracking-[-0.015em]">{r.area}</span>
              <span className="text-[14.5px] leading-[1.5] text-text-2">
                <span className="md:hidden block text-[12px] font-semibold text-muted mb-0.5">Сейчас</span>
                {r.now}
              </span>
              <span className="text-[14.5px] leading-[1.5]">
                <span className="md:hidden block text-[12px] font-semibold text-accent-strong mb-0.5">Для работы</span>
                {r.prod}
              </span>
            </Surface>
          ))}
        </div>
      </Surface>
    </Block>
  );
}

/* ——— Альтернативы ——— */

const MARK: Record<Mark, string> = { "+": "bg-ok-bg text-ok", "−": "bg-bad-bg text-bad", "±": "bg-warn-bg text-warn" };
const MARK_LABEL: Record<Mark, string> = { "+": "плюс", "−": "минус", "±": "отчасти" };

function Alternatives() {
  const cols = `minmax(150px,0.9fr) repeat(${ALTERNATIVES.length}, minmax(168px,1fr))`;
  return (
    <Block id="alt" kicker="Возможные альтернативы" title="Почему веб-приложение"
      lead="Цены — с сайтов на 27.10.2026, в белорусских рублях.">
      <Surface level="panel" pad={8}>
        <div className="overflow-x-auto [scrollbar-width:thin]">
          <div role="table" aria-label="Сравнение вариантов" className="grid min-w-[1000px]" style={{ gridTemplateColumns: cols }}>
            <div role="row" className="contents">
              <div role="columnheader" className="sticky left-0 z-[2] bg-surface" />
              {ALTERNATIVES.map((a) => (
                <div role="columnheader" key={a.key} className={`px-3 pt-4 pb-3 ${a.chosen ? "bg-accent-bg" : ""}`}
                  style={a.chosen ? { borderTopLeftRadius: "var(--r-in)", borderTopRightRadius: "var(--r-in)" } : undefined}>
                  <div className={`text-[16px] font-semibold tracking-[-0.02em] ${a.chosen ? "text-accent-strong" : ""}`}>{a.title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-[1.35] text-muted">{a.note}</div>
                </div>
              ))}
            </div>
            {ALT_CRITERIA.map((c, ri) => {
              const last = ri === ALT_CRITERIA.length - 1;
              return (
                <div role="row" key={c} className="contents">
                  <div role="rowheader" className="sticky left-0 z-[2] bg-surface px-3 py-3 text-[13.5px] font-semibold leading-[1.35] border-t-[0.5px] border-line">
                    {c}
                  </div>
                  {ALTERNATIVES.map((a) => {
                    const cell = a.cells[ri];
                    return (
                      <div role="cell" key={a.key}
                        className={`px-3 py-3 flex gap-2 items-start border-t-[0.5px] ${a.chosen ? "bg-accent-bg border-[rgba(0,135,106,0.14)]" : "border-line"}`}
                        style={a.chosen && last ? { borderBottomLeftRadius: "var(--r-in)", borderBottomRightRadius: "var(--r-in)" } : undefined}>
                        <span aria-label={MARK_LABEL[cell.m]} className={`shrink-0 w-5 h-5 mt-[1px] rounded-full grid place-items-center text-[13px] font-bold leading-none ${MARK[cell.m]}`}>
                          {cell.m}
                        </span>
                        <span className="text-[13px] leading-[1.4] text-text-2">
                          {cell.t}
                          {cell.src && (
                            <a href={cell.src.url} target="_blank" rel="noreferrer"
                              className="ml-1 inline-flex items-center gap-0.5 text-accent-strong hover:underline whitespace-nowrap">
                              {cell.src.name} <ExternalLink size={10} strokeWidth={2.25} />
                            </a>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Surface>
    </Block>
  );
}

/* ——— Стоимость ——— */

const DEPLOY_ICONS: Record<string, LucideIcon> = { rent: Cloud, own: Server };

function Cost() {
  return (
    <Block id="cost" kicker="Сколько стоит" title="Лицензии не нужны, только сервер"
      lead="Цены — с сайта hoster.by на 27.10.2026.">
      <div className="grid md:grid-cols-2 gap-4 items-stretch">
        {DEPLOY.map((d) => (
          <Surface key={d.key} level="panel" pad={24}
            className="flex flex-col" style={d.pick ? { outline: "2px solid var(--accent)", outlineOffset: -2 } : undefined}>
            <div className="flex items-center justify-between gap-3">
              <Glyph icon={DEPLOY_ICONS[d.key]} size={44} />
              {d.pick && <Pill tone="accent">предлагаю</Pill>}
            </div>
            <div className="mt-4 text-[20px] font-semibold tracking-[-0.025em]">{d.title}</div>
            <div className="mt-2 text-[clamp(18px,1.8vw,22px)] font-semibold tracking-[-0.02em] leading-[1.25] text-accent-strong text-balance">{d.price}</div>
            <p className="mt-3 text-[14.5px] leading-[1.5] text-text-2">{d.text}</p>
            {d.src && (
              <div className="mt-auto pt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                {d.src.map((x) => (
                  <a key={x.url} href={x.url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent-strong hover:underline">
                    {x.name} <ExternalLink size={11} strokeWidth={2.25} />
                  </a>
                ))}
              </div>
            )}
          </Surface>
        ))}
      </div>
    </Block>
  );
}

/* ——— Финал ——— */

function Outro() {
  const links = [
    { href: "/me", label: "Мой отпуск", who: "сотрудник" },
    { href: "/team", label: "Согласование", who: "руководитель" },
    { href: "/hr", label: "График", who: "HR и РО1" },
  ];
  return (
    <section className="pt-20 sm:pt-28">
      <Surface level="panel" pad={32} className="text-center sm:!px-12 sm:!py-14">
        <h2 className="text-[clamp(28px,3.6vw,42px)] font-semibold tracking-[-0.035em] leading-[1.08] text-balance">
          Посмотреть прототип
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          {links.map((l, i) => (
            <Link key={l.href} href={l.href}
              className={`${btn} ${i === 0 ? "bg-accent-strong text-white hover:bg-[var(--accent-hover)]" : "bg-fill-2 hover:bg-fill"}`}>
              {l.label}
              <span className={i === 0 ? "text-white/70" : "text-muted"}>{l.who}</span>
            </Link>
          ))}
        </div>
      </Surface>
    </section>
  );
}
