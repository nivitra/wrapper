(async () => {
  const { composeDraft } = await import('/src/ai/fallback.ts')
  const { renderSlide, autofit } = await import('/src/rende r/slide.ts')
  const { ARCHETYPES } = await import('/src/ai/prompts.ts')
  const { THEMES } = await import('/src/design/themes.ts')
  const { defaultSettings } = await import('/src/model/types.ts')

  const host = document.createElement('div')
  host.style.cssText =
    'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:-1;opacity:0.01;pointer-events:none;overflow:hidden'
  document.body.appendChild(host)

  const issues = []
  let count = 0
  const t0 = performance.now()

  for (const theme of THEMES) {
    for (const arch of ARCHETYPES) {
      const req = {
        topic: 'A quarterly strategy review for a mid-market logistics company with 400 staff',
        archetype: arch.id,
        theme: theme.id,
        count: 12,
        tone: 'direct',
        audience: 'executives',
        language: 'English',
        notes: '',
        mustInclude: '',
      }
      const res = composeDraft(req)
      const deck = {
        id: 'x',
        title: res.title,
        subtitle: res.subtitle,
        theme: theme.id,
        archetype: arch.id,
        slides: res.slides,
        settings: { ...defaultSettings(), brand: 'Test Co' },
        createdAt: 0,
        updatedAt: 0,
      }
      for (let i = 0; i < deck.slides.length; i++) {
        const el = renderSlide(deck.slides[i], deck, i, deck.slides.length)
        host.replaceChildren(el)
        autofit(el)
        const frame = el.querySelector('.s-frame')
        const body = el.querySelector('.s-body')
        const fit = parseFloat(el.style.getPropertyValue('--fit') || '1')
        let over = frame.scrollHeight - frame.clientHeight
        if (body) over = Math.max(over, body.scrollHeight - body.clientHeight)
        count++
        if (over > 5 || fit < 0.7) {
          issues.push(`${theme.id}/${arch.id}#${i}/${deck.slides[i].type} fit=${fit} over=${over}`)
        }
      }
    }
  }
  host.remove()
  return JSON.stringify({
    slides: count,
    ms: Math.round(performance.now() - t0),
    issueCount: issues.length,
    issues: issues.slice(0, 30),
  })
})()
