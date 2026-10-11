import React from 'react';

export function FeatureCard({
  icon: Icon,
  title,
  description,
  iconAnimClass,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  /** One of icon-anim-sos/case/report/support (theme.css) — a short,
   * calm, hover-only animation specific to this card, not a continuous
   * loop. */
  iconAnimClass?: string;
}) {
  return (
    <div className="card feature-card" style={{ padding: 26 }}>
      <div
        className={`feature-card-icon ${iconAnimClass ?? ''}`}
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--lp-lavender-pale)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Icon size={22} color="var(--lp-purple-deep)" strokeWidth={1.75} />
      </div>
      <h3 className="lp-card-heading" style={{ fontSize: 18, marginBottom: 6 }}>
        {title}
      </h3>
      <p className="lp-card-description" style={{ paddingBottom: 12 }}>
        {description}
      </p>
      <span className="feature-card-accent" aria-hidden="true" />
    </div>
  );
}
