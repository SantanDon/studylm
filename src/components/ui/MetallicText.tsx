/**
 * MetallicText Component
 * Metallic paint text effect from ReactBits
 * https://reactbits.dev/animations/metallic-paint
 */

import React, { useRef, useEffect } from 'react';

interface MetallicTextProps {
  children: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span';
  speed?: number;
  enabled?: boolean;
}

const MetallicText: React.FC<MetallicTextProps> = ({
  children,
  className = '',
  as: Component = 'span',
  speed = 0.02,
  enabled = true,
}) => {
  const containerRef = useRef<HTMLElement>(null);
  const animationRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const setContainerRef = (element: HTMLElement | null) => {
    containerRef.current = element;
  };

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const animate = () => {
      offsetRef.current += speed;
      if (containerRef.current) {
        containerRef.current.style.backgroundPosition = `${offsetRef.current * 100}% 50%`;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [enabled, speed]);

  if (!enabled) {
    return <Component className={className}>{children}</Component>;
  }

  return (
    <Component
      ref={setContainerRef}
      className={`metallic-text ${className}`}
      style={{
        background: `linear-gradient(
          90deg,
          #1a1a2e 0%,
          #667eea 15%,
          #c4b5fd 30%,
          #f8fafc 45%,
          #c4b5fd 55%,
          #667eea 70%,
          #764ba2 85%,
          #1a1a2e 100%
        )`,
        backgroundSize: '300% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        color: 'transparent',
        display: 'inline-block',
      }}
    >
      {children}
    </Component>
  );
};

export default MetallicText;
