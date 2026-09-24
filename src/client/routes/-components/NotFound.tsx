import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export function NotFound() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto mt-24 max-w-md text-center" data-testid="not-found">
      <h1 className="font-semibold text-2xl">{t('ui.notFound.title')}</h1>
      <p className="mt-2 text-fg-muted">{t('ui.notFound.body')}</p>
      <Link
        to="/today"
        className="mt-6 inline-block text-primary underline-offset-4 hover:underline"
      >
        {t('ui.notFound.home')}
      </Link>
    </div>
  )
}
