const { useRef, useState, useEffect, useMemo, useCallback, memo } = React;
const { motion, AnimatePresence, useScroll, useTransform, useInView } = window["framer-motion"] || window.Motion || window.FramerMotion;

// ─── Adaptive Performance Profile ──────────────────────────────────────────
// Measured once at boot. Desktop keeps the original experience verbatim;
// mobile keeps the same choreography with materially cheaper GPU/CPU work.
const PERF = (() => {
  const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q).matches : false);
  const coarse = mq('(hover: none) and (pointer: coarse)');
  const narrow = mq('(max-width: 900px)');
  const isMobile = coarse || narrow;
  const reduced = mq('(prefers-reduced-motion: reduce)');

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  const effective = conn.effectiveType || '';
  const saveData = conn.saveData === true;
  const slowNet = saveData || effective === '2g' || effective === 'slow-2g';

  const memoryGB = navigator.deviceMemory || (isMobile ? 4 : 8);
  const cores = navigator.hardwareConcurrency || (isMobile ? 4 : 8);
  const lowEnd = isMobile && (memoryGB <= 4 || cores <= 4);

  return {
    isMobile, reduced, slowNet, lowEnd,
    // Download the cinematic background videos at all?
    loadVideo: !slowNet,
    // Drive video.currentTime from scroll position?
    scrubVideo: !slowNet && !reduced,
    // Seeks per second. Mobile hardware decoders cannot service a 60 Hz random
    // seek stream; asking them to just builds an unservable queue and stalls
    // the compositor. 15 Hz looks continuous and stays inside their budget.
    scrubHz: isMobile ? 15 : 60,
    // Scale factor applied to every animated blur radius.
    blurScale: reduced || lowEnd ? 0 : (isMobile ? 0.4 : 1),
    // Per-character text splitting (many independent animated nodes).
    charSplit: !reduced,
    // Replay entrance reveals every time a section re-enters the viewport.
    replayReveals: !isMobile && !reduced,
    // Decorative hover-only layers are dead weight on touch devices.
    hoverEffects: !coarse,
  };
})();

// Animated blur radii, pre-scaled for the current device profile.
const BLUR_ON = PERF.blurScale > 0;
const bpx = (px) => `blur(${Math.round(px * PERF.blurScale * 100) / 100}px)`;
// Attach a filter MotionValue to a style object only when blur is affordable.
const withBlur = (style, filterValue) => (BLUR_ON ? Object.assign(style, { filter: filterValue }) : style);
// Entrance reveals replay on desktop, run once on mobile.
const ONCE = !PERF.replayReveals;
const viewportOpts = (amount) => ({ once: ONCE, amount });

// ─── Text Animation Utilities ───
const defaultStaggerTimes = { char: 0.03, word: 0.05, line: 0.1 };
const defaultContainerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
  exit: { transition: { staggerChildren: 0.05, staggerDirection: -1 } },
};
const defaultItemVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const AnimationComponent = memo(({ segment, variants, per }) => {
  if (per === 'line') return React.createElement(motion.span, { variants, className: 'block' }, segment);
  if (per === 'word') return React.createElement(motion.span, { 'aria-hidden': 'true', variants, className: 'inline-block whitespace-pre' }, segment);
  return React.createElement(motion.span, { className: 'inline-block whitespace-pre' },
    segment.split('').map((char, i) =>
      React.createElement(motion.span, { key: `char-${i}`, 'aria-hidden': 'true', variants, className: 'inline-block whitespace-pre' }, char)
    ));
});

function TextEffect({ children, per = 'word', as = 'p', variants: customVariants, className, delay = 0, trigger = true }) {
  // Splitting a long string per character spawns one independently animated
  // node per glyph. That is affordable for a short headline and ruinous for a
  // paragraph, so long strings fall back to per-word — the reveal still
  // staggers, it just does so in far fewer pieces.
  const resolvedPer = useMemo(() => {
    if (per !== 'char') return per;
    if (!PERF.charSplit) return 'word';
    if (PERF.isMobile && children.length > 24) return 'word';
    return 'char';
  }, [per, children]);

  const segments = useMemo(() => {
    if (resolvedPer === 'line') return children.split('\n');
    if (resolvedPer === 'word') return children.split(/(\s+)/);
    return children.split('');
  }, [resolvedPer, children]);

  const containerVariants = customVariants?.container || defaultContainerVariants;
  const itemVariants = customVariants?.item || defaultItemVariants;
  const stagger = defaultStaggerTimes[per];
  const delayedContainerVariants = {
    hidden: containerVariants.hidden,
    visible: {
      ...containerVariants.visible,
      transition: {
        ...(containerVariants.visible?.transition || {}),
        staggerChildren: containerVariants.visible?.transition?.staggerChildren || stagger,
        delayChildren: delay,
      },
    },
    exit: containerVariants.exit,
  };
  const MotionTag = motion[as] || motion.p;
  return React.createElement(AnimatePresence, null,
    trigger && React.createElement(MotionTag, {
      initial: 'hidden', animate: 'visible', exit: 'exit',
      variants: delayedContainerVariants,
      className: `whitespace-pre-wrap ${className || ''}`,
    },
      segments.map((segment, index) =>
        React.createElement(AnimationComponent, { key: `${resolvedPer}-${index}-${segment}`, segment, variants: itemVariants, per: resolvedPer })
      )));
}

// ─── Shared Components ───
function ArrowUpRight({ className }) {
  return React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg', width: 24, height: 24,
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeLinecap: 'round', strokeLinejoin: 'round', className
  },
    React.createElement('path', { d: 'M7 7h10v10' }),
    React.createElement('path', { d: 'M7 17 17 7' }));
}

// Per-segment reveal. On capable devices every glyph animates blur+brightness;
// on mobile the same stagger, easing and travel are kept but the two filter
// passes per node are dropped, because a compound filter on dozens of
// simultaneously animating spans is what actually stalls a phone GPU.
const blurSlideVariants = BLUR_ON ? {
  container: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.015 } },
    exit: { opacity: 0, transition: { staggerChildren: 0.01, staggerDirection: -1 } },
  },
  item: {
    hidden: { opacity: 0, filter: `${bpx(10)} brightness(0%)`, y: 20 },
    visible: { opacity: 1, y: 0, filter: 'blur(0px) brightness(100%)', transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -20, filter: `${bpx(10)} brightness(0%)`, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
  },
} : {
  container: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.02 } },
    exit: { opacity: 0, transition: { staggerChildren: 0.012, staggerDirection: -1 } },
  },
  item: {
    hidden: { opacity: 0, y: 18 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, y: -18, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
  },
};

const otherElementVariants = {
  hidden: { opacity: 0, y: 35 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -25, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

// ─── Services Data ───
const allServices = [
  { num: '01', name: 'AI Automation', desc: 'Turn repetitive operations into intelligent automated workflows.' },
  { num: '02', name: 'AI Agents', desc: 'Build intelligent agents for support, lead qualification, internal operations and customer experiences.' },
  { num: '03', name: 'SaaS Development', desc: 'Turn ambitious product ideas into scalable, production-ready SaaS platforms.' },
  { num: '04', name: 'Business Automation', desc: 'Connect your tools, data and workflows so your business can operate with less manual work.' },
  { num: '05', name: 'Landing Pages', desc: 'High-impact landing pages designed to communicate value and drive action.' },
  { num: '06', name: 'UI/UX Design', desc: 'Design digital products that feel intuitive, premium and effortless to use.' },
  { num: '07', name: 'Website Revamps', desc: 'Transform outdated digital experiences into modern, high-performance websites.' },
  { num: '08', name: 'AI Product Prototyping', desc: 'Rapidly turn an AI idea into a functional prototype that can be tested in the real world.' }
];

// ─── Service Card ───
// Memoised: `service` is a stable module-level object, so a re-render of the
// grid never re-renders the eight cards. Hover state stays local to one card.
const ServiceCard = memo(function ServiceCard({ service }) {
  const [hovered, setHovered] = useState(false);
  const interactive = PERF.hoverEffects;
  const hoverHandlers = interactive
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : null;

  return React.createElement('a', Object.assign({
    href: 'https://wa.me/917420823984',
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': `${service.name} — start a project on WhatsApp`,
    className: 'block relative group border border-white/10 rounded-2xl p-6 lg:p-8 transition-all duration-300 cursor-pointer overflow-hidden',
    style: {
      background: hovered ? 'rgba(139, 92, 246, 0.06)' : 'rgba(255,255,255,0.02)',
      borderColor: hovered ? 'rgba(139, 92, 246, 0.3)' : undefined,
      boxShadow: hovered ? '0 0 40px rgba(139, 92, 246, 0.08), inset 0 0 40px rgba(139, 92, 246, 0.03)' : 'none',
      transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
    },
  }, hoverHandlers),
    // A 64px-radius blurred radial glow that can only ever be revealed by a
    // mouse. On touch devices it is eight permanently-invisible blur layers,
    // so it is simply not mounted there.
    interactive && React.createElement('div', {
      className: 'absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl transition-opacity duration-500 pointer-events-none',
      style: { background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)', opacity: hovered ? 1 : 0 }
    }),
    React.createElement('div', { className: 'relative z-10' },
      React.createElement('div', { className: 'flex items-center gap-3 mb-5' },
        React.createElement('span', { className: 'text-[11px] font-medium text-purple-400/70 tracking-[0.15em]' }, service.num),
        React.createElement('div', { className: 'h-px flex-1 bg-white/10' })
      ),
      React.createElement('h3', {
        className: 'text-[16px] lg:text-[18px] font-medium tracking-tight text-white mb-3 transition-colors duration-300',
        style: { color: hovered ? '#c4b5fd' : undefined }
      }, service.name),
      React.createElement('p', { className: 'text-[13px] text-white/45 leading-relaxed' }, service.desc)
    )
  );
});

// ─── Services Section ───
function ServicesSection() {
  return React.createElement('section', { id: 'services', className: 'w-full max-w-none mx-auto px-4 lg:px-[56px] py-[80px] bg-transparent relative z-10' },
    React.createElement('div', { className: 'w-full max-w-[1200px] mx-auto' },
      React.createElement('div', { className: 'mb-12' },
        React.createElement('span', { className: 'text-[11.5px] font-medium uppercase text-white/50 tracking-[0.15em] block mb-4' }, '006 \u2014 What We Build'),
        React.createElement('h2', { className: 'text-[clamp(28px,3.5vw,42px)] font-medium leading-[1.15] tracking-tight text-white max-w-[700px]' }, 'Digital solutions built for scale.'),
        React.createElement('p', { className: 'text-[14px] text-white/45 mt-4 max-w-[500px] leading-relaxed' }, 'From AI automation to premium web experiences, every solution is designed to move your business forward.')
      ),
      React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
        allServices.map((service) =>
          React.createElement(ServiceCard, { key: service.num, service: service })
        )
      )
    )
  );
}

// ─── FAQ Section ───
function FAQSection() {
  const [openIndex, setOpenIndex] = useState(null);
  const faqs = [
    { q: 'What does Blackgrid do?', a: 'Blackgrid builds premium websites, AI-powered products, automation systems, and digital experiences for ambitious brands and businesses.' },
    { q: 'Can you build a website from scratch?', a: 'Yes. From strategy and UI/UX to development, deployment, and optimization, projects can be handled end-to-end.' },
    { q: 'Do you work with startups and small businesses?', a: 'Yes. Projects can be tailored around the client\u2019s current stage, goals, and budget.' },
    { q: 'Can you integrate AI into my existing business?', a: 'Yes. AI can be integrated into workflows such as customer support, lead qualification, content operations, internal tools, and business automation.' },
    { q: 'Can you redesign an existing website?', a: 'Yes. Existing websites can be upgraded while preserving important functionality and content.' },
    { q: 'How long does a project take?', a: 'Project timelines depend on complexity. A focused landing page can be delivered much faster than a full SaaS or AI system.' },
    { q: 'Do you provide support after launch?', a: 'Yes. Ongoing maintenance, improvements, bug fixes, and feature development can be provided.' },
    { q: 'How do I start a project?', a: 'Contact Blackgrid through WhatsApp and share what you\u2019re trying to build. From there, the project requirements can be discussed.' }
  ];
  const handleToggle = useCallback((i) => setOpenIndex((prev) => (prev === i ? null : i)), []);
  return React.createElement('section', { id: 'faq', className: 'w-full max-w-none mx-auto px-4 lg:px-[56px] py-[80px] bg-transparent relative z-10' },
    React.createElement('div', { className: 'w-full max-w-[800px] mx-auto' },
      React.createElement('div', { className: 'mb-14' },
        React.createElement('span', { className: 'text-[11.5px] font-medium uppercase text-purple-400/70 tracking-[0.15em] block mb-4' }, 'FAQ'),
        React.createElement('h2', { className: 'text-[clamp(28px,3.5vw,42px)] font-medium leading-[1.15] tracking-tight text-white mb-4' }, 'Questions, answered.'),
        React.createElement('p', { className: 'text-[14px] text-white/45 max-w-[480px] leading-relaxed' }, 'Everything you need to know before building something exceptional.')
      ),
      React.createElement('div', { className: 'flex flex-col' },
        faqs.map((faq, i) =>
          React.createElement(FAQItem, { key: i, index: i, faq: faq, isOpen: openIndex === i, onToggle: handleToggle })
        )
      )
    )
  );
}

const FAQItem = memo(function FAQItem({ faq, index, isOpen, onToggle }) {
  return React.createElement('div', { className: 'border-b border-white/10' },
    React.createElement('button', {
      onClick: () => onToggle(index),
      type: 'button',
      className: 'w-full flex items-center justify-between py-5 lg:py-6 text-left transition-colors duration-200',
      'aria-expanded': isOpen,
    },
      React.createElement('span', {
        className: 'text-[15px] lg:text-[16px] font-medium tracking-tight transition-colors duration-200',
        style: { color: isOpen ? '#c4b5fd' : 'rgba(255,255,255,0.8)' }
      }, faq.q),
      React.createElement('span', {
        className: 'flex-shrink-0 ml-4 w-7 h-7 flex items-center justify-center rounded-full transition-all duration-300',
        style: { background: isOpen ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.05)' }
      },
        React.createElement('svg', {
          width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none',
          stroke: isOpen ? '#a78bfa' : 'rgba(255,255,255,0.4)',
          strokeWidth: 1.5, strokeLinecap: 'round',
          className: 'transition-transform duration-300',
          style: { transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)' }
        },
          React.createElement('line', { x1: '7', y1: '1', x2: '7', y2: '13' }),
          React.createElement('line', { x1: '1', y1: '7', x2: '13', y2: '7' })
        )
      )
    ),
    React.createElement(AnimatePresence, null,
      isOpen && React.createElement(motion.div, {
        initial: { height: 0, opacity: 0 },
        animate: { height: 'auto', opacity: 1 },
        exit: { height: 0, opacity: 0 },
        transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
        className: 'overflow-hidden'
      },
        React.createElement('p', {
          className: 'text-[13.5px] lg:text-[14px] text-white/45 leading-relaxed pb-5 lg:pb-6'
        }, faq.a)
      )
    )
  );
});

// ─── Process Pipeline Data ───
const pipeline = [
  { num: '01', name: 'DISCOVER', title: 'Understand the problem.', desc: 'We start by understanding the business, audience, goals and the problem that actually needs solving.', input: 'Idea / Problem / Goal', output: 'Clear direction' },
  { num: '02', name: 'DESIGN', title: 'Shape the experience.', desc: 'We transform the direction into a clear visual system, user experience and product architecture.', input: 'Strategy', output: 'Design / Experience' },
  { num: '03', name: 'BUILD', title: 'Turn ideas into reality.', desc: 'We develop the actual digital experience with clean architecture, responsive interfaces and production-ready technology.', input: 'Design', output: 'Working Product' },
  { num: '04', name: 'INTELLIGENCE', title: 'Add the intelligence.', desc: 'When useful, we integrate AI, APIs, automations and intelligent workflows that make the product more powerful.', input: 'Product', output: 'Intelligent System' },
  { num: '05', name: 'LAUNCH', title: 'Make it real.', desc: 'We test, optimize and deploy the finished system so it is ready for real users.', input: 'Production Build', output: 'Live Product' },
  { num: '06', name: 'EVOLVE', title: 'Keep building.', desc: 'Launch is not the end. Products can continuously improve through new features, optimization and iteration.', input: 'Real-world Feedback', output: 'Next Version' }
];

// ─── Pipeline Stage ───
// Memoised and fed pre-computed booleans instead of the raw `activeIndex`.
// Previously every one of the six stages re-rendered each time the active
// stage changed while scrolling; now only the two that actually change do.
const PipelineStage = memo(function PipelineStage({ stage, index, isActive, isPast, isLast, onActivate }) {
  const [expanded, setExpanded] = useState(false);
  const stageRef = useRef(null);
  const isInView = useInView(stageRef, { amount: 0.5, margin: '-10% 0px -30% 0px' });

  useEffect(() => {
    if (isInView) onActivate(index);
  }, [isInView, index, onActivate]);

  // BUGFIX: this was the string 'motion.div', so React emitted a literal
  // <motion.div> unknown element and leaked `initial`/`whileInView`/`viewport`
  // objects onto the DOM as attributes. The stage never animated and React
  // re-serialised those objects on every render.
  return React.createElement(motion.div, {
    ref: stageRef,
    className: 'relative cursor-pointer group',
    initial: { opacity: 0, y: 30 },
    whileInView: { opacity: 1, y: 0 },
    viewport: viewportOpts(0.3),
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
    onClick: () => setExpanded((v) => !v),
    onMouseEnter: PERF.hoverEffects ? () => onActivate(index) : undefined,
  },
    React.createElement('div', {
      className: 'flex items-start gap-6 lg:gap-10 py-6 transition-all duration-500',
      style: { opacity: isPast ? 0.45 : 1 }
    },
      React.createElement('div', { className: 'flex flex-col items-center shrink-0' },
        React.createElement('div', {
          className: 'w-12 h-12 lg:w-14 lg:h-14 rounded-full flex items-center justify-center text-[13px] font-medium tracking-wider transition-all duration-500 border',
          style: {
            background: isActive ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.03)',
            borderColor: isActive ? 'rgba(139, 92, 246, 0.5)' : 'rgba(255,255,255,0.1)',
            color: isActive ? '#a78bfa' : 'rgba(255,255,255,0.5)',
            boxShadow: isActive ? '0 0 30px rgba(139, 92, 246, 0.15)' : 'none'
          }
        }, stage.num),
        !isLast && React.createElement('div', {
          className: 'w-px flex-1 min-h-[40px] transition-all duration-700',
          style: {
            background: isPast
              ? 'linear-gradient(180deg, rgba(139,92,246,0.4) 0%, rgba(139,92,246,0.1) 100%)'
              : isActive
                ? 'linear-gradient(180deg, rgba(139,92,246,0.3) 0%, rgba(255,255,255,0.08) 100%)'
                : 'rgba(255,255,255,0.08)'
          }
        })
      ),
      React.createElement('div', { className: 'flex-1 min-w-0' },
        React.createElement('div', {
          className: 'text-[11px] font-medium uppercase tracking-[0.2em] mb-2 transition-colors duration-300',
          style: { color: isActive ? '#a78bfa' : 'rgba(255,255,255,0.35)' }
        }, stage.name),
        React.createElement('h3', {
          className: 'text-[20px] lg:text-[24px] font-medium tracking-tight mb-3 transition-colors duration-300',
          style: { color: isActive ? '#ffffff' : 'rgba(255,255,255,0.6)' }
        }, stage.title),
        React.createElement('p', {
          className: 'text-[13.5px] lg:text-[14px] leading-relaxed max-w-[560px] transition-colors duration-300',
          style: { color: isActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.3)' }
        }, stage.desc),
        React.createElement(AnimatePresence, null,
          expanded && isActive && React.createElement(motion.div, {
            initial: { height: 0, opacity: 0 },
            animate: { height: 'auto', opacity: 1 },
            exit: { height: 0, opacity: 0 },
            transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
            className: 'overflow-hidden'
          },
            React.createElement('div', { className: 'flex gap-8 mt-5 pt-5 border-t border-white/10' },
              React.createElement('div', null,
                React.createElement('div', { className: 'text-[10px] font-medium uppercase tracking-[0.2em] text-purple-400/60 mb-1' }, 'INPUT'),
                React.createElement('div', { className: 'text-[13px] text-white/50' }, stage.input)
              ),
              React.createElement('div', null,
                React.createElement('div', { className: 'text-[10px] font-medium uppercase tracking-[0.2em] text-purple-400/60 mb-1' }, 'OUTPUT'),
                React.createElement('div', { className: 'text-[13px] text-white/50' }, stage.output)
              )
            )
          )
        )
      )
    )
  );
});

// ─── Process Section ───
function ProcessSection() {
  const [activeStage, setActiveStage] = useState(0);
  const processRef = useRef(null);
  const pipelineHeaderRef = useRef(null);

  const { scrollYProgress: processScroll } = useScroll({ target: processRef, offset: ["start end", "end start"] });
  const processOpacity = useTransform(processScroll, [0, 0.12], [0, 1]);
  const processY = useTransform(processScroll, [0, 0.12], [60, 0]);

  return React.createElement('section', { ref: processRef, id: 'process', className: 'w-full relative z-10' },
    // Process Hero
    React.createElement('div', { className: 'w-full px-4 lg:px-[56px] py-[100px] lg:py-[160px] flex items-center justify-center' },
      React.createElement(motion.div, {
        initial: { opacity: 0, y: 40 },
        whileInView: { opacity: 1, y: 0 },
        viewport: viewportOpts(0.4),
        transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
        className: 'text-center max-w-[800px] mx-auto'
      },
        React.createElement('div', { className: 'text-[11px] font-medium uppercase text-purple-400/70 tracking-[0.2em] mb-6' }, 'THE BLACKGRID METHOD'),
        React.createElement('h2', { className: 'text-[clamp(36px,6vw,72px)] font-normal leading-[0.95] tracking-tight text-white mb-8' }, 'How We Build'),
        React.createElement('p', { className: 'text-[15px] lg:text-[16px] text-white/45 leading-relaxed max-w-[560px] mx-auto' }, 'From the first idea to the final launch, every project moves through a system designed to turn ambitious ideas into real digital experiences.')
      )
    ),
    // Pipeline
    React.createElement(motion.div, { ref: pipelineHeaderRef, style: { opacity: processOpacity, y: processY }, className: 'w-full px-4 lg:px-[56px] py-[40px] lg:py-[60px]' },
      React.createElement('div', { className: 'w-full max-w-[900px] mx-auto' },
        React.createElement('div', { className: 'mb-12' },
          React.createElement('span', { className: 'text-[11px] font-medium uppercase text-purple-400/60 tracking-[0.2em] block mb-3' }, 'BUILD PIPELINE'),
          React.createElement('h3', { className: 'text-[clamp(24px,3vw,36px)] font-medium leading-[1.15] tracking-tight text-white' }, 'Every project follows the same system.')
        ),
        React.createElement('div', { className: 'flex flex-col' },
          pipeline.map((stage, i) =>
            React.createElement(PipelineStage, {
              key: i, stage: stage, index: i,
              isActive: activeStage === i,
              isPast: activeStage > i,
              isLast: i === pipeline.length - 1,
              onActivate: setActiveStage,
            })
          )
        )
      )
    ),
    // Signature
    React.createElement('section', { className: 'w-full px-4 lg:px-[56px] py-[120px] lg:py-[180px]' },
      React.createElement('div', { className: 'w-full max-w-[900px] mx-auto text-center' },
        React.createElement(motion.h2, { initial: { opacity: 0, y: 30 }, whileInView: { opacity: 1, y: 0 }, viewport: viewportOpts(0.5), transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] }, className: 'text-[clamp(28px,4vw,52px)] font-normal leading-[1.1] tracking-tight text-white/40 mb-8' }, 'You bring the problem.'),
        React.createElement(motion.h2, { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: viewportOpts(0.5), transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.15 }, className: 'text-[clamp(32px,5vw,64px)] font-medium leading-[1.05] tracking-tight text-white mb-16' }, 'We build what solves it.'),
        React.createElement('p', { className: 'text-[16px] text-white/40 mb-8' }, 'Ready to build something different?'),
        React.createElement('a', {
          href: 'https://wa.me/917420823984',
          target: '_blank', rel: 'noopener noreferrer',
          className: 'group inline-flex items-center justify-center bg-white hover:bg-white/90 text-brand-bg rounded-full px-8 py-4 text-sm font-medium w-fit gap-3 transition-all'
        },
          React.createElement('span', { className: 'tracking-tight' }, 'START A PROJECT'),
          React.createElement('span', { className: 'flex items-center justify-center w-5 h-5 rounded-full bg-brand-bg text-white transition-transform group-hover:scale-105' },
            React.createElement(ArrowUpRight, { className: 'w-3.5 h-3.5 stroke-[2.5]' })
          )
        )
      )
    ),
    // Micro
    React.createElement('section', { className: 'w-full px-4 lg:px-[56px] pb-[80px]' },
      React.createElement('div', { className: 'w-full max-w-[900px] mx-auto border-t border-white/10 pt-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4' },
        React.createElement('div', { className: 'text-[11px] font-medium uppercase text-white/30 tracking-[0.2em]' }, 'BLACKGRID / BUILD SYSTEM'),
        React.createElement('div', { className: 'text-[12px] text-white/25 tracking-wide' }, 'Strategy \u2192 Design \u2192 Technology \u2192 Intelligence \u2192 Launch')
      )
    )
  );
}

// ─── Cinematic Background Media ────────────────────────────────────────────
const HERO_VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260701_091244_186b0374-b961-4059-b31d-84b819807185.mp4';
const SOLUTIONS_VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260707_040817_939f16e8-836c-4249-aa1d-63f3e2978a89.mp4';

// Attributes shared by both scrubbed videos.
//   - `disableRemotePlayback` / `disablePictureInPicture` stop mobile Chrome
//     and Safari from attaching casting + PiP machinery to a purely decorative
//     surface, which also keeps the media-session UI from appearing.
//   - The videos are decorative, so they are hidden from assistive tech.
//   - On a metered or 2G connection the source is never attached at all; the
//     brand gradient behind it carries the section instead.
const videoBaseProps = {
  className: 'w-full h-full object-cover',
  muted: true,
  playsInline: true,
  'webkit-playsinline': 'true',
  disablePictureInPicture: true,
  disableRemotePlayback: true,
  'aria-hidden': 'true',
  tabIndex: -1,
};

// ─── Scroll-Scrubbed Video ─────────────────────────────────────────────────
// Replaces the two near-identical effects that previously drove these videos.
//
// What the old implementation did wrong, and what this fixes:
//
//  1. The rAF loop was unconditional and never stopped. Two loops ran at 60 Hz
//     for the entire life of the page — while the section was offscreen, while
//     the page was in a background tab, and while nothing was moving at all.
//     Here the loop is started by scroll, stops the moment the value settles,
//     and cannot run while the section is out of view or the tab is hidden.
//
//  2. The scroll handler called getBoundingClientRect() *and* read
//     `scrollHeight` on every scroll event. `scrollHeight` forces a synchronous
//     layout flush, so every scroll tick invalidated and re-computed layout —
//     classic layout thrashing, and the main reason scrolling felt sticky.
//     Geometry is now measured once (on mount / resize / orientation change)
//     and cached; the scroll path reads only `scrollY`, which is free.
//
//  3. It issued a seek every single frame. A random seek is not a cheap
//     operation — a mobile hardware decoder has to locate and decode from a
//     keyframe. Asking for 60 of those per second builds a queue the decoder
//     can never drain, which is what produced the freezing, the stutter and
//     the decoder crashes on Android. Seeks are now rate-limited to a device
//     appropriate frequency and skipped entirely while one is still in flight.
function useScrubbedVideo(videoRef, containerRef, { subtractViewport }) {
  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || !PERF.scrubVideo) return;

    let target = 0, current = 0, raf = 0;
    let inView = true, pageVisible = !document.hidden;
    let lastSeekAt = 0;
    let originTop = 0, range = 1;
    const minSeekGap = 1000 / PERF.scrubHz;
    const seekEpsilon = PERF.isMobile ? 0.05 : 0.02;

    // Layout reads: batched, and never interleaved with writes.
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      originTop = rect.top + scrollY;
      const h = subtractViewport ? container.offsetHeight - window.innerHeight : container.offsetHeight;
      range = Math.max(1, h);
    };

    const readProgress = () => {
      const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      const p = (scrollY - originTop) / range;
      target = p < 0 ? 0 : p > 1 ? 1 : p;
    };

    const tick = (now) => {
      raf = 0;
      const delta = target - current;
      current += delta * 0.12;
      if (Math.abs(delta) < 0.0005) current = target;

      const duration = video.duration;
      if (duration && isFinite(duration) && duration > 0) {
        const t = current * duration;
        if (!video.seeking && (now - lastSeekAt) >= minSeekGap && Math.abs(video.currentTime - t) > seekEpsilon) {
          lastSeekAt = now;
          try { video.currentTime = t; } catch (e) { /* decoder not ready yet */ }
        }
      }
      // Settled? Stop burning frames. Scrolling will restart us.
      if (Math.abs(target - current) > 0.0005) schedule();
    };

    function schedule() {
      if (raf || !inView || !pageVisible) return;
      raf = requestAnimationFrame(tick);
    }

    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

    const onScroll = () => { readProgress(); schedule(); };

    // Coalesce resize storms. Mobile browsers fire resize continuously while
    // the URL bar collapses; re-measuring on each one would be pure jank.
    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { measure(); readProgress(); schedule(); }, 150);
    };

    const onVisibility = () => {
      pageVisible = !document.hidden;
      if (pageVisible) schedule(); else stop();
    };

    const onMeta = () => { measure(); readProgress(); current = target; schedule(); };

    // Only drive (and only fully buffer) the video near its own section.
    const io = new IntersectionObserver((entries) => {
      inView = entries[0].isIntersecting;
      if (inView) {
        if (video.preload !== 'auto' && video.getAttribute('src')) { video.preload = 'auto'; video.load(); }
        measure(); readProgress(); schedule();
      } else {
        stop();
        current = target; // resume in the right place without a catch-up sweep
      }
    }, { rootMargin: '25% 0px 25% 0px' });
    io.observe(container);

    measure();
    readProgress();
    current = target;
    schedule();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    video.addEventListener('loadedmetadata', onMeta);

    return () => {
      stop();
      clearTimeout(resizeTimer);
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      video.removeEventListener('loadedmetadata', onMeta);
      // Release the decoder and its buffered data on unmount.
      try { video.removeAttribute('src'); video.load(); } catch (e) {}
    };
  }, [videoRef, containerRef, subtractViewport]);
}

// ─── Main App ───
function App() {
  const scrollContainerRef = useRef(null);
  const videoRef = useRef(null);
  const videoRef2 = useRef(null);
  const heroRef = useRef(null);
  const aboutRef = useRef(null);
  const solutionsRef = useRef(null);

  const inViewHero = useInView(heroRef, { amount: 0.15, once: ONCE });
  const inViewAbout = useInView(aboutRef, { amount: 0.15, once: ONCE });

  const { scrollYProgress: videoScrollProgress } = useScroll({ target: scrollContainerRef, offset: ["start start", "end start"] });
  const videoOpacity = useTransform(videoScrollProgress, [0.9, 1.0], [1, 0]);

  // Background hero video: progress across the whole scroll container.
  useScrubbedVideo(videoRef, scrollContainerRef, { subtractViewport: false });
  // Solutions video: progress across the sticky section only.
  useScrubbedVideo(videoRef2, solutionsRef, { subtractViewport: true });

  const { scrollYProgress } = useScroll({ target: solutionsRef, offset: ["start start", "end end"] });
  const { scrollYProgress: heroScroll } = useScroll({ target: heroRef, offset: ["start start", "end start"] });

  const heroTitleOpacity = useTransform(heroScroll, [0, 0.45], [1, 0]);
  const heroTitleBlur = useTransform(heroScroll, [0, 0.45], ["blur(0px)", bpx(20)]);
  const heroTitleY = useTransform(heroScroll, [0, 0.45], [0, -60]);
  const heroOtherOpacity = useTransform(heroScroll, [0, 0.45], [1, 0]);
  const heroOtherY = useTransform(heroScroll, [0, 0.45], [0, -40]);

  const { scrollYProgress: aboutScroll } = useScroll({ target: aboutRef, offset: ["start end", "end start"] });
  const aboutTitleOpacity = useTransform(aboutScroll, [0.1, 0.35, 0.65, 0.9], [0, 1, 1, 0]);
  const aboutTitleBlur = useTransform(aboutScroll, [0.1, 0.35, 0.65, 0.9], [bpx(20), "blur(0px)", "blur(0px)", bpx(20)]);
  const aboutTitleY = useTransform(aboutScroll, [0.1, 0.35, 0.65, 0.9], [60, 0, 0, -60]);
  const aboutOtherOpacity = useTransform(aboutScroll, [0.15, 0.35, 0.65, 0.85], [0, 1, 1, 0]);
  const aboutOtherY = useTransform(aboutScroll, [0.15, 0.35, 0.65, 0.85], [50, 0, 0, -50]);

  const opacitySet1 = useTransform(scrollYProgress, [0, 0.05, 0.22, 0.29], [0, 1, 1, 0]);
  const blurSet1 = useTransform(scrollYProgress, [0, 0.05, 0.22, 0.29], [bpx(15), "blur(0px)", "blur(0px)", bpx(15)]);
  const yTopSet1 = useTransform(scrollYProgress, [0, 0.29], ["0px", "-120px"]);
  const yBottomSet1 = useTransform(scrollYProgress, [0, 0.29], ["0px", "120px"]);

  const opacitySet2 = useTransform(scrollYProgress, [0.33, 0.40, 0.58, 0.65], [0, 1, 1, 0]);
  const blurSet2 = useTransform(scrollYProgress, [0.33, 0.40, 0.58, 0.65], [bpx(15), "blur(0px)", "blur(0px)", bpx(15)]);
  const yTopSet2 = useTransform(scrollYProgress, [0.33, 0.65], ["0px", "-120px"]);
  const yBottomSet2 = useTransform(scrollYProgress, [0.33, 0.65], ["0px", "120px"]);

  const opacitySet3 = useTransform(scrollYProgress, [0.69, 0.76, 0.92, 0.99], [0, 1, 1, 0]);
  const blurSet3 = useTransform(scrollYProgress, [0.69, 0.76, 0.92, 0.99], [bpx(15), "blur(0px)", "blur(0px)", bpx(15)]);
  const yTopSet3 = useTransform(scrollYProgress, [0.69, 0.99], ["0px", "-120px"]);
  const yBottomSet3 = useTransform(scrollYProgress, [0.69, 0.99], ["0px", "120px"]);

  return React.createElement('div', { className: 'relative w-full min-h-screen' },

    // Header
    React.createElement('header', { className: 'bg-header fixed top-4 lg:top-5 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-32px)] md:w-auto bg-slate-950/55 backdrop-blur-xl rounded-xl p-1 pl-1 pr-5 flex items-center justify-between md:gap-8 transition-all' },
      React.createElement('div', { className: 'flex items-center justify-center w-10 h-10 bg-white/10 hover:bg-white/15 rounded-lg text-white text-xl select-none leading-none cursor-pointer transition-all duration-300 hover:rotate-45 active:scale-95 shrink-0' }, '\u2733'),
      React.createElement('nav', { className: 'flex items-center gap-4 lg:gap-5' },
        React.createElement('a', { href: '#solutions', className: 'text-white/75 hover:text-white text-xs lg:text-[13.5px] font-medium tracking-tight whitespace-nowrap transition-colors' }, 'Solutions'),
        React.createElement('a', { href: '#about', className: 'text-white/75 hover:text-white text-xs lg:text-[13.5px] font-medium tracking-tight whitespace-nowrap transition-colors' }, 'About'),
        React.createElement('a', { href: '#services', className: 'text-white/75 hover:text-white text-xs lg:text-[13.5px] font-medium tracking-tight whitespace-nowrap transition-colors' }, 'Services'),
        React.createElement('a', { href: '#process', className: 'text-white/75 hover:text-white text-xs lg:text-[13.5px] font-medium tracking-tight whitespace-nowrap transition-colors' }, 'Process'),
        React.createElement('a', { href: 'https://wa.me/917420823984', target: '_blank', rel: 'noopener noreferrer', className: 'text-white/75 hover:text-white text-xs lg:text-[13.5px] font-medium tracking-tight whitespace-nowrap transition-colors' }, 'Contact')
      )
    ),

    // Background Video
    React.createElement(motion.div, { style: { opacity: videoOpacity }, className: 'fixed inset-0 w-full h-full z-0 select-none pointer-events-none overflow-hidden' },
      React.createElement('video', Object.assign({}, videoBaseProps, {
        ref: videoRef,
        src: PERF.loadVideo ? HERO_VIDEO_SRC : undefined,
        // Above the fold and immediately scrubbed, so this one genuinely does
        // need its data up front.
        preload: PERF.loadVideo ? 'auto' : 'none',
      }))
    ),

    // Scroll Container
    React.createElement('div', { ref: scrollContainerRef, className: 'relative z-10 w-full bg-transparent' },

      // Hero Section
      React.createElement('section', { ref: heroRef, className: 'relative w-full h-screen flex items-center overflow-hidden bg-transparent' },
        React.createElement('main', { className: 'relative z-10 w-full max-w-none mx-auto h-screen px-4 lg:px-[56px] pt-28 lg:pt-0 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center' },
          React.createElement('div', { className: 'lg:col-span-7 flex flex-col justify-center h-full lg:-translate-y-[112px] transform' },
            React.createElement(motion.div, { style: withBlur({ opacity: heroTitleOpacity, y: heroTitleY }, heroTitleBlur) },
              React.createElement('h1', { className: 'text-[clamp(40px,6.5vw,105px)] font-normal leading-[0.95] tracking-tight mb-10 text-white flex flex-col' },
                React.createElement('span', { className: 'block' }, React.createElement(TextEffect, { per: 'char', variants: blurSlideVariants, trigger: inViewHero }, 'Automate')),
                React.createElement('span', { className: 'block' }, React.createElement(TextEffect, { per: 'char', variants: blurSlideVariants, trigger: inViewHero, delay: 0.15 }, 'Everything.'))
              )
            ),
            React.createElement(motion.div, { style: { opacity: heroOtherOpacity, y: heroOtherY } },
              React.createElement(motion.div, { variants: otherElementVariants, initial: 'hidden', animate: inViewHero ? 'visible' : 'exit' },
                React.createElement('a', { href: '#solutions', className: 'group inline-flex items-center justify-center bg-white hover:bg-white/90 text-brand-bg rounded-full px-7 py-3.5 text-sm font-normal w-fit gap-3 shadow-none transition-all' },
                  React.createElement('span', { className: 'flex items-center justify-center w-5 h-5 rounded-full bg-brand-bg text-white transition-transform group-hover:scale-105' }, React.createElement(ArrowUpRight, { className: 'w-3.5 h-3.5 stroke-[2.5]' })),
                  React.createElement('span', { className: 'tracking-tight' }, 'Discover BLACKGRID')
                )
              )
            )
          ),
          React.createElement(motion.div, { style: { opacity: heroOtherOpacity, y: heroOtherY }, className: 'lg:col-span-4 lg:col-start-9 flex flex-col justify-center lg:self-end lg:mb-[56px] lg:justify-self-end w-full max-w-[328px]' },
            React.createElement(motion.div, { variants: otherElementVariants, initial: 'hidden', animate: inViewHero ? 'visible' : 'exit' },
              React.createElement('div', { className: 'text-[11.5px] font-normal uppercase text-white/50 tracking-[0.15em] mb-3' }, '001 \u2014 AI Systems'),
              React.createElement('p', { className: 'text-[14.5px] font-normal leading-relaxed text-white tracking-tight' }, 'BLACKGRID builds intelligent AI systems that automate complex business processes, turning manual workflows into autonomous operations.')
            )
          )
        )
      ),

      // About Section
      React.createElement('section', { id: 'about', ref: aboutRef, className: 'w-full max-w-none mx-auto px-4 lg:px-[56px] h-screen min-h-[600px] py-[56px] flex flex-col justify-between items-start bg-transparent' },
        React.createElement('div', { className: 'w-full flex flex-col gap-6' },
          React.createElement(motion.div, { style: { opacity: aboutOtherOpacity, y: aboutOtherY } },
            React.createElement(motion.div, { variants: otherElementVariants, initial: 'hidden', animate: inViewAbout ? 'visible' : 'exit' },
              React.createElement('span', { className: 'text-[11.5px] font-medium uppercase text-white/50 tracking-[0.15em]' }, '002 \u2014 Automation Engine')
            )
          ),
          React.createElement('div', { className: 'w-full' },
            React.createElement(motion.div, { style: withBlur({ opacity: aboutTitleOpacity, y: aboutTitleY }, aboutTitleBlur) },
              React.createElement(TextEffect, { per: 'word', as: 'p', variants: blurSlideVariants, trigger: inViewAbout, className: 'text-[clamp(24px,3.2vw,40px)] font-medium leading-[1.25] tracking-tight text-white max-w-[1200px]' },
                '\u2460 BLACKGRID is an advanced AI automation company that turns complex business processes into intelligent automated systems. From lead generation to customer support, we build the infrastructure that lets businesses operate smarter.'
              )
            )
          ),
          React.createElement('div', { className: 'grid grid-cols-1 lg:grid-cols-12 w-full gap-8' },
            React.createElement(motion.div, { style: { opacity: aboutOtherOpacity, y: aboutOtherY }, className: 'lg:col-start-1 lg:col-span-4 flex flex-col w-full max-w-[328px]' },
              React.createElement(motion.div, { variants: otherElementVariants, initial: 'hidden', animate: inViewAbout ? 'visible' : 'exit', className: 'w-full' },
                React.createElement('div', { className: 'text-[11.5px] font-medium uppercase text-white/50 tracking-[0.15em] mb-5' }, 'Services:'),
                React.createElement('div', { className: 'flex flex-col w-full border-b border-white/15' },
                  allServices.map((item) =>
                    React.createElement('a', { key: item.num, href: '#services', className: 'group flex justify-between items-center py-4 border-t border-white/15 text-white transition-opacity' },
                      React.createElement('span', { className: 'text-[14.5px] font-medium tracking-tight' }, item.name),
                      React.createElement('span', { className: 'flex items-center justify-center w-5 h-5 rounded-full bg-white text-brand-bg transition-transform group-hover:scale-110 ml-3 shrink-0' }, React.createElement(ArrowUpRight, { className: 'w-3.5 h-3.5 stroke-[2.5]' }))
                    )
                  )
                )
              )
            )
          )
        )
      ),

      // Solutions Section
      React.createElement('section', { id: 'solutions', ref: solutionsRef, className: 'w-full min-h-[350vh] bg-transparent relative' },
        React.createElement('div', { className: 'w-full h-screen sticky top-0 overflow-hidden flex flex-col justify-between' },
          React.createElement('div', { className: 'absolute inset-0 w-full h-full select-none pointer-events-none z-0' },
            React.createElement('video', Object.assign({}, videoBaseProps, {
              ref: videoRef2,
              src: PERF.loadVideo ? SOLUTIONS_VIDEO_SRC : undefined,
              // Several screens below the fold. Start at metadata only so it
              // does not compete with the hero video for bandwidth and decoder
              // time on first load; the IntersectionObserver in
              // useScrubbedVideo promotes it to `auto` as it approaches.
              preload: PERF.loadVideo ? 'metadata' : 'none',
            }))
          ),
          React.createElement('div', { className: 'relative z-10 w-full max-w-none mx-auto h-full px-4 lg:px-[56px] flex flex-col justify-center items-start' },
            React.createElement('div', { className: 'w-full max-w-[1000px] h-[320px] lg:h-[400px] relative flex items-center justify-start' },
              React.createElement(motion.div, { style: withBlur({ opacity: opacitySet1 }, blurSet1), className: 'absolute inset-0 flex flex-col gap-[40px] justify-center pointer-events-none' },
                React.createElement(motion.div, { style: { y: yTopSet1 }, className: 'w-full flex flex-col gap-6' },
                  React.createElement('span', { className: 'text-[11.5px] font-medium uppercase text-white/50 tracking-[0.15em]' }, '003 \u2014 Intelligence'),
                  React.createElement('h1', { className: 'text-[clamp(40px,6.5vw,105px)] font-normal leading-[0.95] tracking-tight text-white w-full' }, 'Automate the work.')
                ),
                React.createElement(motion.div, { style: { y: yBottomSet1 }, className: 'w-full' },
                  React.createElement('h1', { className: 'text-[clamp(40px,6.5vw,105px)] font-normal leading-[0.95] tracking-tight text-white w-full' }, 'BLACKGRID.')
                )
              ),
              React.createElement(motion.div, { style: withBlur({ opacity: opacitySet2 }, blurSet2), className: 'absolute inset-0 flex flex-col gap-[40px] justify-center pointer-events-none' },
                React.createElement(motion.div, { style: { y: yTopSet2 }, className: 'w-full flex flex-col gap-6' },
                  React.createElement('span', { className: 'text-[11.5px] font-medium uppercase text-white/50 tracking-[0.15em]' }, '004 \u2014 Performance'),
                  React.createElement('h1', { className: 'text-[clamp(40px,6.5vw,105px)] font-normal leading-[0.95] tracking-tight text-white w-full' }, 'Amplify the business.')
                ),
                React.createElement(motion.div, { style: { y: yBottomSet2 }, className: 'w-full' },
                  React.createElement('h1', { className: 'text-[clamp(40px,6.5vw,105px)] font-normal leading-[0.95] tracking-tight text-white w-full' }, 'Autonomously.')
                )
              ),
              React.createElement(motion.div, { style: withBlur({ opacity: opacitySet3 }, blurSet3), className: 'absolute inset-0 flex flex-col gap-[40px] justify-center pointer-events-none' },
                React.createElement(motion.div, { style: { y: yTopSet3 }, className: 'w-full flex flex-col gap-6' },
                  React.createElement('span', { className: 'text-[11.5px] font-medium uppercase text-white/50 tracking-[0.15em]' }, '005 \u2014 Scale'),
                  React.createElement('h1', { className: 'text-[clamp(40px,6.5vw,105px)] font-normal leading-[0.95] tracking-tight text-white w-full' }, 'Intelligent systems.')
                ),
                React.createElement(motion.div, { style: { y: yBottomSet3 }, className: 'w-full' },
                  React.createElement('h1', { className: 'text-[clamp(40px,6.5vw,105px)] font-normal leading-[0.95] tracking-tight text-white w-full' }, 'Infinite leverage.')
                )
              )
            )
          )
        )
      )
    ),

    // Services Section
    React.createElement(ServicesSection),

    // FAQ Section
    React.createElement(FAQSection),

    // Process Section (How We Build)
    React.createElement(ProcessSection),

    // Social Links
    React.createElement('div', { className: 'w-full relative z-10 px-4 lg:px-[56px] py-16 flex items-center justify-end gap-6' },
      React.createElement('a', { href: 'https://github.com/vedant2011-byte', target: '_blank', rel: 'noopener noreferrer', className: 'text-white/50 hover:text-white text-xs lg:text-[13.5px] font-medium tracking-tight whitespace-nowrap transition-colors' }, 'GitHub'),
      React.createElement('a', { href: 'https://www.instagram.com/vedant_chavan____?stkn=MWJ1ZXJsaHZpejZsYQ%3D%3D', target: '_blank', rel: 'noopener noreferrer', className: 'text-white/50 hover:text-white text-xs lg:text-[13.5px] font-medium tracking-tight whitespace-nowrap transition-colors' }, 'Instagram')
    )
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
