'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // A tooltip is informational CHROME, not an interaction target, so it takes
          // the structural anchor rather than the interaction hue (Seven Seas rule 1).
          // It also fixes a real AA failure: white on --primary is 3.61:1 and this
          // label is text-xs (12px), which does not reach the large-text exemption.
          // White on --nav-anchor is 12.4:1.
          'bg-nav-anchor text-nav-anchor-foreground z-50 w-fit rounded-md px-3 py-1.5 text-xs',
          'data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in',
          'data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:fade-in-0',
          'data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[state=closed]:duration-150',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
