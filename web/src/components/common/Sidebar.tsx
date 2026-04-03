import { Dialog, Transition } from "@headlessui/react";
import { Fragment } from "react";
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
  return (
    <nav className="flex flex-col gap-1">
      {links.map(({ href, label, icon: Icon }) => (
        <a
          key={href}
          href={href}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-teal/30 hover:text-white"
        >
          {Icon && <Icon className="h-5 w-5" />}
          {label}
        </a>
      ))}
    </nav>
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
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-white/60 hover:text-white"
                >
                  <PiXBold className="h-5 w-5" />
                </button>
              </div>
              <NavLinks links={links} />
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-teal/20 lg:bg-dark/50 lg:p-4">
        <div className="mb-6">
          <span className="text-lg font-semibold text-white">{title}</span>
        </div>
        <NavLinks links={links} />
      </aside>
    </>
  );
}
