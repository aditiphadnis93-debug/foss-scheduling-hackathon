import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

/**
 * DynamicModal component provides a positioning-aware modal that positions itself
 * relative to a trigger element, similar to DynamicDropdown but for modal content.
 *
 * Props:
 * - isOpen (Boolean): Controls modal visibility
 * - onClose (Function): Callback when modal should close
 * - triggerRef (Ref): Reference to the element that triggered the modal
 * - children (ReactNode): Content to display in the modal
 * - className (String): Additional CSS classes for the modal
 *
 * The component handles positioning to ensure it remains within viewport boundaries
 * and updates its position dynamically on scroll or resize events.
 */

const DynamicModal = ({
  isOpen,
  onClose,
  triggerRef,
  children,
  className = "",
}) => {
  const [position, setPosition] = useState({ top: -9999, left: -9999 });
  const [isPositioned, setIsPositioned] = useState(false);
  const modalRef = useRef(null);
  const PADDING = 8;

  /**
   * Recalculates the position of the modal based on the current scroll and
   * resize state of the window. It ensures the modal is always fully visible within
   * the viewport by trying different positions and adjusting its coordinates accordingly.
   *
   * The function first tries to position the modal below the trigger element, then above,
   * then to the right, and finally to the left. If none of these positions provide enough
   * space, it falls back to positioning the modal in the direction with the most available
   * space, which may result in the modal being clipped.
   */
  const updatePosition = useCallback(() => {
    if (!isOpen || !triggerRef?.current) return;

    // Get the current position of the trigger element in the viewport
    const triggerRect = triggerRef.current.getBoundingClientRect();
    if (!triggerRect) return;

    // Get the current modal dimensions if available, otherwise use estimates
    const modalHeight = modalRef.current?.offsetHeight || 350;
    const modalWidth = modalRef.current?.offsetWidth || 280;

    // Calculate space available in different directions within the viewport
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const spaceRight = window.innerWidth - triggerRect.right;
    const spaceLeft = triggerRect.left;

    let top, left;

    // 1. Try positioning BELOW the trigger
    if (spaceBelow >= modalHeight + PADDING) {
      top = triggerRect.bottom + PADDING;
      left = triggerRect.left;

      // Ensure horizontal bounds
      if (left + modalWidth + PADDING > window.innerWidth) {
        left = Math.max(PADDING, window.innerWidth - modalWidth - PADDING);
      }
    }
    // 2. Try positioning ABOVE the trigger
    else if (spaceAbove >= modalHeight + PADDING) {
      top = triggerRect.top - modalHeight - PADDING;
      left = triggerRect.left;

      // Ensure horizontal bounds
      if (left + modalWidth + PADDING > window.innerWidth) {
        left = Math.max(PADDING, window.innerWidth - modalWidth - PADDING);
      }
    }
    // 3. Try positioning to the RIGHT of the trigger
    else if (spaceRight >= modalWidth + PADDING) {
      left = triggerRect.right + PADDING;

      // Try to vertically center with trigger
      top = triggerRect.top + triggerRect.height / 2 - modalHeight / 2;

      // Ensure vertical bounds
      if (top < PADDING) {
        top = PADDING;
      } else if (top + modalHeight + PADDING > window.innerHeight) {
        top = Math.max(PADDING, window.innerHeight - modalHeight - PADDING);
      }
    }
    // 4. Try positioning to the LEFT of the trigger
    else if (spaceLeft >= modalWidth + PADDING) {
      left = triggerRef.current.getBoundingClientRect().left - modalWidth - PADDING;

      // Try to vertically center with trigger
      top = triggerRect.top + triggerRect.height / 2 - modalHeight / 2;

      // Ensure vertical bounds
      if (top < PADDING) {
        top = PADDING;
      } else if (top + modalHeight + PADDING > window.innerHeight) {
        top = Math.max(PADDING, window.innerHeight - modalHeight - PADDING);
      }
    }
    // 5. FALLBACK: Position in the direction with most space
    else {
      const spaces = [spaceBelow, spaceAbove, spaceRight, spaceLeft];
      const maxSpace = Math.max(...spaces);

      if (maxSpace === spaceBelow) {
        // Position below, but potentially clipped
        top = triggerRect.bottom + PADDING;
        left = triggerRect.left;
      } else if (maxSpace === spaceAbove) {
        // Position above, but potentially clipped
        top = triggerRect.top - modalHeight - PADDING;
        left = triggerRect.left;
      } else if (maxSpace === spaceRight) {
        // Position right, but potentially clipped
        left = triggerRect.right + PADDING;
        top = triggerRect.top;
      } else {
        // Position left, but potentially clipped
        left = Math.max(PADDING, triggerRect.left - modalWidth - PADDING);
        top = triggerRect.top;
      }

      // Final bounds checking
      left = Math.max(
        PADDING,
        Math.min(left, window.innerWidth - modalWidth - PADDING)
      );
      top = Math.max(
        PADDING,
        Math.min(top, window.innerHeight - modalHeight - PADDING)
      );
    }

    // Calculate absolute position by adding current scroll position
    // This converts viewport-relative coordinates to absolute document coordinates
    // Only mark as positioned if we actually have valid non-zero coordinates
    if (top > 0 || left > 0) {
      setPosition({
        top: top + window.scrollY,
        left: left + window.scrollX,
      });
      setIsPositioned(true);
    }
  }, [isOpen, triggerRef]);

  // Set up scroll and resize event handlers
  useEffect(() => {
    if (!isOpen) return;

    /**
     * Handles clicks outside the modal.
     *
     * Closes the modal if the click event target is not within the trigger element
     * or the modal itself. This helps to ensure that the modal closes
     * when a user clicks elsewhere on the page.
     *
     * @param {Event} e - The mouse event triggered by the click.
     */
    const handleOutsideClick = (e) => {
      if (
        triggerRef?.current &&
        !triggerRef.current.contains(e.target) &&
        !modalRef.current?.contains(e.target)
      ) {
        onClose();
      }
    };

    /**
     * Handles scroll events on any scrollable parent.
     *
     * This is critical for making the modal follow the trigger element
     * when the page or any parent container is scrolled.
     */
    const handleScroll = () => {
      // Immediately recalculate position on any scroll event
      requestAnimationFrame(updatePosition);
    };

    /**
     * Handles escape key press to close the modal.
     */
    const handleEscKey = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscKey);

    // Use capture phase to catch all scroll events in any parent container
    window.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });

    // Handle window resize events
    window.addEventListener("resize", updatePosition);

    // Disable body scroll to prevent page movement while modal is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscKey);
      window.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("resize", updatePosition);

      // Restore body scroll
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose, triggerRef, updatePosition]);

  // Reposition when modal size changes (e.g. FilterModal expanding 220→560px)
  useEffect(() => {
    if (!isOpen || !isPositioned || !modalRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      updatePosition();
    });
    resizeObserver.observe(modalRef.current);

    return () => resizeObserver.disconnect();
  }, [isOpen, isPositioned, updatePosition]);

  // Update position synchronously before paint to prevent position flash
  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
    } else {
      setIsPositioned(false);
      setPosition({ top: -9999, left: -9999 });
    }
  }, [isOpen, updatePosition]);

  return createPortal(
    <>
      {/* Phase 1: Ghost div for measurement — invisible, off-screen, not interactive */}
      {isOpen && !isPositioned && (
        <div
          ref={modalRef}
          style={{
            position: "absolute",
            top: -9999,
            left: -9999,
            visibility: "hidden",
            opacity: 0,
            pointerEvents: "none",
          }}
          className={`bg-white border rounded-xl w-fit h-fit ${className}`}
        >
          {children}
        </div>
      )}

      {/* Phase 2: Real modal — only mounts after position is known */}
      <AnimatePresence>
        {isOpen && isPositioned && (
          <>
            {/* Backdrop with fade animation */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/30 z-[8]"
              onClick={onClose}
            />

            {/* REAL MODAL CONTENT (Only mounts after stable positioning) */}
            <motion.div
              ref={modalRef}
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  scale: 1,
                  y: 0,
                  transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] }
                }
              }}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className={`absolute z-[8] bg-white border rounded-xl w-fit h-fit overflow-y-auto shadow-lg transition-none ${className}`}
              style={{
                top: `${position.top}px`,
                left: `${position.left}px`,
              }}
              role="dialog"
              aria-modal="true"
              onWheel={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
};

export default DynamicModal;
