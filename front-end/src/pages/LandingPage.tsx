import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../landing.css";

interface LandingPageProps {
  isAuthenticated: boolean;
  onLogout: () => void;
}

type LandingValueCard = {
  icon: string;
  title: string;
  body: string;
};

type LandingContentCard = {
  tag: string;
  title: string;
  body: string;
};

type LandingSceneCard = {
  eyebrow: string;
  title: string;
  body: string;
};

type LandingFooterColumn = {
  title: string;
  lines: string[];
};

type LandingContent = {
  brandCN: string;
  brandEN: string;
  navItems: string[];
  heroTitle: string;
  heroSubtitle: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  trustStats: Array<{ value: string; label: string }>;
  kvTags: string[];
  valueTitle: string;
  valueSubtitle: string;
  valueCards: LandingValueCard[];
  contentTitle: string;
  contentSubtitle: string;
  featuredContent: LandingContentCard;
  secondaryContents: LandingContentCard[];
  sceneTitle: string;
  sceneSubtitle: string;
  sceneCards: LandingSceneCard[];
  aboutTitle: string;
  aboutSubtitle: string;
  aboutParagraphs: string[];
  aboutPillars: string[];
  brandMotto: string;
  footerColumns: LandingFooterColumn[];
  footerCopyright: string;
  footerTagline: string;
};

const DEFAULT_CONTENT: LandingContent = {
  brandCN: "心境",
  brandEN: "Mira",
  navItems: ["重新评估", "陪伴服务", "治愈内容", "关于我们"],
  heroTitle: "心如明镜，照见自我",
  heroSubtitle:
    "在你情绪起伏的每一刻，Mira 都以温柔、理解与专业陪伴你，慢慢走向更稳的内在节奏。",
  heroPrimaryCta: "立即开始",
  heroSecondaryCta: "了解更多",
  trustStats: [
    { value: "24/7", label: "温柔陪伴" },
    { value: "1v1", label: "真实连接" },
    { value: "长期", label: "持续成长" }
  ],
  kvTags: ["情绪识别", "呼吸引导", "睡前放松", "自我接纳", "成长记录"],
  valueTitle: "核心价值",
  valueSubtitle: "少一些说教，多一些被理解。每一次对话都为了让你更靠近真实的自己。",
  valueCards: [
    {
      icon: "☾",
      title: "陪伴",
      body: "一对一温柔对话，在低落、焦虑或疲惫时，给你稳定而不评判的在场感。"
    },
    {
      icon: "◌",
      title: "连接",
      body: "把模糊的感受说清楚，让被忽略的情绪被看见，重新连接身体与内心。"
    },
    {
      icon: "✧",
      title: "成长",
      body: "通过日常练习与回顾，形成属于你的情绪照护节律，慢慢长出内在力量。"
    }
  ],
  contentTitle: "今日治愈内容",
  contentSubtitle: "精简而有力量的内容推荐，让你在碎片时间里也能找回平静。",
  featuredContent: {
    tag: "今日一句",
    title: "你不需要立刻变好，先允许自己慢一点。",
    body: "当你愿意停下来感受呼吸，焦虑就有了出口。真正的恢复，往往从温柔地看见自己开始。"
  },
  secondaryContents: [
    {
      tag: "睡前放松",
      title: "给夜晚一个柔软的结尾",
      body: "3 分钟呼吸引导，帮助大脑从高压切换到休息模式。"
    },
    {
      tag: "自我接纳",
      title: "把“我应该”换成“我正在学习”",
      body: "练习对自己说更友善的话，让内在评价慢慢变得温和。"
    },
    {
      tag: "情绪整理",
      title: "先命名感受，再解决问题",
      body: "把“乱”说成“焦虑、委屈、疲惫”，你会更容易找回掌控感。"
    }
  ],
  sceneTitle: "温柔生活时刻",
  sceneSubtitle: "那些看似微小的片段，正在悄悄修复你。",
  sceneCards: [
    {
      eyebrow: "晨光",
      title: "在第一缕光里，和自己重新对齐",
      body: "拉开窗帘，缓慢呼吸 10 秒。提醒自己：今天不必完美，也值得被好好对待。"
    },
    {
      eyebrow: "夜晚",
      title: "把白天的噪音，留在门外",
      body: "睡前写下三件已完成的小事，让心从“紧绷”回到“安稳”。"
    }
  ],
  aboutTitle: "关于心境",
  aboutSubtitle: "面向大学生的心理陪伴平台",
  aboutParagraphs: [
    "心境 Mira 专注于大学生常见的压力、焦虑与自我怀疑场景，帮助你理解情绪背后的真实需求。",
    "我们通过持续陪伴与可执行的心理练习，让支持真正落到每天的学习、生活与人际关系中。"
  ],
  aboutPillars: ["理解情绪", "提供支持", "陪伴成长"],
  brandMotto: "品牌理念：愿每个年轻心灵，都能在被理解中慢慢发光。",
  footerColumns: [
    {
      title: "心境 Mira",
      lines: ["让情绪被看见，让成长被温柔接住。", "专为大学生设计的现代心理陪伴体验。"]
    },
    { title: "快速链接", lines: ["重新评估", "陪伴服务", "治愈内容", "关于我们"] },
    {
      title: "联系我们",
      lines: ["邮箱：hello@xinjingmira.com", "反馈建议：欢迎告诉我们你的真实感受。"]
    }
  ],
  footerCopyright: "© 2026 心境 Mira. All rights reserved.",
  footerTagline: "用心照见自己，在陪伴中慢慢变得更稳。"
};

const TYPEWRITER_LINES = ["先慢慢说，Mira 在听。", "我们可以从一次呼吸开始。"];

export function LandingPage({ isAuthenticated, onLogout }: LandingPageProps): JSX.Element {
  const navigate = useNavigate();
  const [content, setContent] = useState<LandingContent>(DEFAULT_CONTENT);
  const heroTitleRef = useRef<HTMLHeadingElement | null>(null);
  const [heroTitleSize, setHeroTitleSize] = useState<number | null>(null);
  const [typedLine, setTypedLine] = useState("");
  const [lineIndex, setLineIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch("/landing-content.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`landing content ${res.status}`);
        const next = (await res.json()) as Partial<LandingContent>;
        if (active) setContent({ ...DEFAULT_CONTENT, ...next });
      } catch {
        if (active) setContent(DEFAULT_CONTENT);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [content]);

  useEffect(() => {
    const el = heroTitleRef.current;
    if (!el) return;

    const computeFont = (): void => {
      const parent = el.parentElement;
      if (!parent) return;
      if (window.innerWidth < 1200) {
        setHeroTitleSize(null);
        return;
      }

      const available = Math.max(300, parent.clientWidth - 24);
      const text = content.heroTitle;
      const style = window.getComputedStyle(el);
      const weight = style.fontWeight || "700";
      const family = style.fontFamily || "sans-serif";

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let low = 34;
      let high = 68;
      let best = 34;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        ctx.font = `${weight} ${mid}px ${family}`;
        const width = ctx.measureText(text).width;
        if (width <= available) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      let finalSize = best;
      el.style.fontSize = `${finalSize}px`;
      let guard = 24;
      while (el.scrollWidth > available && finalSize > 30 && guard > 0) {
        finalSize -= 1;
        el.style.fontSize = `${finalSize}px`;
        guard -= 1;
      }

      setHeroTitleSize(finalSize);
    };

    computeFont();
    window.addEventListener("resize", computeFont);
    return () => window.removeEventListener("resize", computeFont);
  }, [content.heroTitle]);

  useEffect(() => {
    const current = TYPEWRITER_LINES[lineIndex] ?? "";
    const doneTyping = typedLine === current;
    const doneDeleting = typedLine.length === 0;

    let delay = isDeleting ? 95 : 170;
    if (!isDeleting && doneTyping) delay = 2200;
    if (isDeleting && doneDeleting) delay = 420;

    const timer = window.setTimeout(() => {
      if (!isDeleting && doneTyping) {
        setIsDeleting(true);
        return;
      }

      if (isDeleting && doneDeleting) {
        setIsDeleting(false);
        setLineIndex((prev) => (prev + 1) % TYPEWRITER_LINES.length);
        return;
      }

      if (isDeleting) {
        setTypedLine(current.slice(0, typedLine.length - 1));
      } else {
        setTypedLine(current.slice(0, typedLine.length + 1));
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [typedLine, lineIndex, isDeleting]);

  const enterMind = (): void => {
    if (isAuthenticated) {
      navigate("/mind");
      return;
    }
    navigate("/login?mode=login");
  };

  const scrollTo = (id: string): void => {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderHeroTitle = (title: string): JSX.Element => {
    const commaIndex = title.indexOf("，");
    if (commaIndex === -1) return <>{title}</>;
    const first = title.slice(0, commaIndex + 1);
    const second = title.slice(commaIndex + 1);
    return (
      <>
        <span className="hero-title-segment">{first}</span>
        <span className="hero-title-segment">{second}</span>
      </>
    );
  };

  return (
    <div className="mira-home">
      <header className="mira-nav glass-shell">
        <div className="mira-brand">
          <span className="brand-cn">{content.brandCN}</span>
          <span className="brand-sep">|</span>
          <span className="brand-en">{content.brandEN}</span>
        </div>

        <nav className="mira-nav-links">
          <button type="button" onClick={() => scrollTo("hero")}>
            {content.navItems[0]}
          </button>
          <button type="button" onClick={() => scrollTo("value")}>
            {content.navItems[1]}
          </button>
          <button type="button" onClick={() => scrollTo("content")}>
            {content.navItems[2]}
          </button>
          <button type="button" onClick={() => scrollTo("about")}>
            {content.navItems[3]}
          </button>
        </nav>

        <div className="mira-nav-actions">
          {isAuthenticated ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={onLogout}>
                退出登录
              </button>
              <button type="button" className="btn btn-primary" onClick={enterMind}>
                进入心境
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/login?mode=login")}>
                登录
              </button>
              <button type="button" className="btn btn-primary" onClick={enterMind}>
                立即体验
              </button>
            </>
          )}
        </div>
      </header>

      <main>
        <section id="hero" className="hero reveal">
          <div className="hero-copy">
            <h1 ref={heroTitleRef} className="hero-title" style={heroTitleSize ? { fontSize: `${heroTitleSize}px` } : undefined}>
              {renderHeroTitle(content.heroTitle)}
            </h1>
            <p className="hero-subtitle">{content.heroSubtitle}</p>
            <div className="hero-cta">
              <button type="button" className="btn btn-primary large" onClick={enterMind}>
                {content.heroPrimaryCta}
              </button>
              <button type="button" className="btn btn-ghost large" onClick={() => scrollTo("about")}>
                {content.heroSecondaryCta}
              </button>
            </div>
            <div className="trust-row">
              {content.trustStats.map((item) => (
                <article className="trust-item" key={`${item.value}-${item.label}`}>
                  <div className="trust-value">{item.value}</div>
                  <div className="trust-label">{item.label}</div>
                </article>
              ))}
            </div>
          </div>

          <div className="hero-kv">
            <div className="kv-bg-orb orb-a" />
            <div className="kv-bg-orb orb-b" />
            <div className="kv-bg-orb orb-c" />
            <div className="glass-shell kv-card">
              <div className="kv-card-head">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
              <h3>心境 Mira Companion</h3>
              <p>今晚你想先被倾听，还是先放松下来？</p>
              <div className="kv-wave" aria-label="Mira 打字机动态文案">
                <p className="kv-typewriter">
                  <span>{typedLine || "\u00A0"}</span>
                  <span className="kv-caret" aria-hidden="true" />
                </p>
              </div>
              <div className="kv-tags">
                {content.kvTags.map((tag) => (
                  <span key={tag} className="kv-tag">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="value" className="section reveal">
          <header className="section-head">
            <h2 className="section-title">{content.valueTitle}</h2>
            <p className="section-subtitle">{content.valueSubtitle}</p>
          </header>
          <div className="value-grid">
            {content.valueCards.map((item) => (
              <article className="glass-shell value-card" key={item.title}>
                <span className="value-icon">{item.icon}</span>
                <h3 className="value-title">{item.title}</h3>
                <p className="value-body">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="content" className="section reveal">
          <header className="section-head">
            <h2 className="section-title">{content.contentTitle}</h2>
            <p className="section-subtitle">{content.contentSubtitle}</p>
          </header>

          <div className="content-layout">
            <article className="glass-shell feature-card">
              <span className="chip warm">{content.featuredContent.tag}</span>
              <h3 className="feature-title">{content.featuredContent.title}</h3>
              <p className="feature-body">{content.featuredContent.body}</p>
            </article>

            <div className="content-side">
              {content.secondaryContents.map((item) => (
                <article className="glass-shell side-content-card" key={item.title}>
                  <span className="chip">{item.tag}</span>
                  <h3 className="side-content-title">{item.title}</h3>
                  <p className="side-content-body">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section reveal">
          <header className="section-head">
            <h2 className="section-title">{content.sceneTitle}</h2>
            <p className="section-subtitle">{content.sceneSubtitle}</p>
          </header>
          <div className="scene-grid">
            {content.sceneCards.map((item, idx) => (
              <article className={`scene-card scene-${idx + 1}`} key={item.title}>
                <span className="scene-eyebrow">{item.eyebrow}</span>
                <h3 className="scene-title">{item.title}</h3>
                <p className="scene-body">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="about" className="section reveal">
          <div className="glass-shell about-panel">
            <header className="about-head">
              <h2 className="section-title left">{content.aboutTitle}</h2>
              <p className="about-subtitle">{content.aboutSubtitle}</p>
            </header>
            <div className="about-columns">
              <div className="about-copy">
                {content.aboutParagraphs.map((item) => (
                  <p className="about-text" key={item}>
                    {item}
                  </p>
                ))}
                <p className="about-motto">{content.brandMotto}</p>
              </div>
              <div className="about-pillars">
                {content.aboutPillars.map((item) => (
                  <span className="about-pill" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mira-footer">
        <div className="footer-grid">
          {content.footerColumns.map((col) => (
            <section className="footer-col" key={col.title}>
              <h3 className="footer-title">{col.title}</h3>
              {col.lines.map((line) => (
                <p className="footer-line" key={line}>
                  {line}
                </p>
              ))}
            </section>
          ))}
        </div>
        <div className="footer-bottom">
          <p className="footer-copy">{content.footerCopyright}</p>
          <p className="footer-tagline">{content.footerTagline}</p>
        </div>
      </footer>
    </div>
  );
}
