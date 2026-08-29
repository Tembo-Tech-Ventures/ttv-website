import { Dialog, Transition } from "@headlessui/react";
import React, { Fragment } from "react";
import type { IconType } from "react-icons";
import { PiXBold } from "react-icons/pi";

interface SidebarLink {
  href: string;
  label: string;
  icon?: IconType;
}

interface SidebarProps {
  links: SidebarLink[];
  title: string;
  isOpen: boolean;
  onClose: () => void;
}

function NavLinks({ links }: { links: SidebarLink[] }) {
  const currentPath = typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <nav className="flex flex-col gap-1">
      {links.map(({ href, label, icon: Icon }) => {
        const isActive = currentPath === href || (href !== "/" && href !== "/admin" && href !== "/dashboard" && currentPath.startsWith(href));
        return (
          <a
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary/20 text-primary"
                : "text-white/80 hover:bg-teal/30 hover:text-white"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {Icon && <Icon className="h-5 w-5" />}
            {label}
          </a>
        );
      })}
    </nav>
  );
}

export function SidebarCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close navigation"
      onClick={onClose}
      className="rounded-md p-1 text-ink-secondary hover:text-white"
    >
      <PiXBold className="h-5 w-5" />
    </button>
  );
}

export default function Sidebar({ links, title, isOpen, onClose }: SidebarProps) {
  return (
    <>
      {/* Mobile sidebar overlay */}
      <Transition show={isOpen} as={Fragment}>
        <Dialog onClose={onClose} className="relative z-50 lg:hidden">
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/60" />
          </Transition.Child>

          <Transition.Child
            as={Fragment}
            enter="transition ease-in-out duration-200 transform"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition ease-in-out duration-200 transform"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <Dialog.Panel className="fixed inset-y-0 left-0 flex w-64 flex-col bg-dark border-r border-teal/20 p-4">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-lg font-semibold text-white">
                  {title}
                </span>
                <SidebarCloseButton onClose={onClose} />
              </div>
              <NavLinks links={links} />
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition>

      {/*
        Desktop sidebar. `self-start` is load-bearing: a flex item defaults to
        `align-self: stretch`, which makes this as tall as the whole page, and an
        element as tall as its container can never stick. Without it the nav
        scrolled off the top of every long admin page while the coloured strip
        stayed — which read as the navigation simply vanishing.
      */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-teal/20 lg:bg-dark/50 lg:p-4">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-white">{title}</h1>
        </div>
        <NavLinks links={links} />
      </aside>
    </>
  );
}
