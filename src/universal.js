import { basename, dirname } from 'path';
import { hostname } from 'os';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer';
import express from 'express';
import { once, composeP, identity } from 'ramda';
import inlineCss from 'inline-css';

/**
 * @constant defaultOptions
 * @type {Object}
 */
const defaultOptions = {
    debug: false,
    hostname: hostname(),
    protocol: 'http',
    persistent: true,
    keepResolvedClass: false
};

/**
 * @method createServer :: string -> number
 * @param {String} rootPath
 * @return {Number}
 *
 * Creates the Express server once and once only, with a random port being assigned that the function yields.
 */
const createServer = once(rootPath => {
    const app = express();
    app.use(express.static(dirname(rootPath)));
    return app.listen(0).address().port;
});

/**
 * @method openBrowser :: object -> object
 * @param {Object} opts
 * @return {Object}
 */
const openBrowser = once(opts => {
    return puppeteer.launch({ headless: !opts.debug });
});

/**
 * @method elementsDidResolve :: object -> Promise
 * @param {Object} page
 * @return {Promise}
 *
 * Filters out elements that are controlled by Switzerland, and waits them to be resolved. Puppeteer invokes the
 * passed function continuously until it yields a truthy value.
 */
function elementsDidResolve(page) {

    return page.waitFor(() => {

        return Array.from(document.querySelectorAll('*')).filter(node => node.switzerland).every(node => {
            node.setAttribute('data-switzerland', '');
            return node.classList.contains('resolved');
        });

    });

}

/**
 * @method replaceSlot :: HTMLElement -> HTMLSlotElement -> HTMLSlotElement
 * @param {HTMLElement} childNode
 * @param {HTMLSlotElement} slot
 * @return {HTMLSlotElement}
 *
 * Replaces the given slot with the passed child node, if the child node exists in the DOM.
 */
function replaceSlot(childNode, slot) {

    if (childNode) {
        slot.innerHTML = '';
        slot.appendChild(childNode);
    }

    return slot;

}

/**
 * @method handleSlots :: string -> string
 * @param {String} content
 * @return {String}
 *
 * Takes the HTML string representation of the DOM and fills in the `slot` nodes using either the default slot
 * approach, or by using named slots.
 */
async function handleSlots(content) {

    const dom = new JSDOM(content);
    const args = [null, dom.window.XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null];
    const seenSlots = new Set();

    Array.from(dom.window.document.querySelectorAll('*[data-switzerland].resolved')).sort((a, b) => {

        // Order by the parent count so we handle the deepest components first, which prevents components less
        // further down from dealing with `slot`s from a nested component.
        const parentCountA = dom.window.document.evaluate('ancestor::*', a, ...args);
        const parentCountB = dom.window.document.evaluate('ancestor::*', b, ...args);
        return parentCountA.snapshotLength < parentCountB.snapshotLength;

    }).forEach(node => {

        const slots = Array.from(node.querySelectorAll('slot'));

        slots.filter(slot => !seenSlots.has(slot)).forEach(slot => {

            // Memorise the slot so we don't handle it again.
            seenSlots.add(slot);

            const isDefaultSlot = !slot.hasAttribute('name');
            const childNodes = Array.from(node.childNodes).filter(node => node.nodeName.toLowerCase() !== 'shadow-boundary');

            return isDefaultSlot ? replaceSlot(childNodes[0], slot) : do {
                const childNode = childNodes.find(node => node.getAttribute('slot') === slot.getAttribute('name'));
                replaceSlot(childNode, slot);
            };

        });

    });

    return dom.serialize();

}

/**
 * @method removeResolved
 * @param {String} content
 * @return {String}
 *
 * Takes the DOM string and removes the "resolved" class name, as the component should be re-rendered if/when it's
 * renderered using true shadow boundaries.
 */
function removeResolved(content) {

    const dom = new JSDOM(content);

    dom.window.document.querySelectorAll('*[data-switzerland].resolved').forEach(node => {
        node.classList.remove('resolved');
    });

    return dom.serialize();

}

/**
 * @method renderToString :: string -> object -> Promise
 * @param {String} rootPath
 * @param {Boolean} [options = defaultOptions]
 * @return {String}
 *
 * Takes the path to the HTML document and any options and gives back a string representation of the DOM
 * with all styles inlined, and `slot` elements removed.
 */
export default async function renderToString(rootPath, options = defaultOptions) {

    const opts = { ...defaultOptions, ...options };
    const port = createServer(rootPath);
    const url = `${opts.protocol}://${opts.hostname}:${port}/${basename(rootPath)}`;

    const browser = await openBrowser(opts);
    const page = await browser.newPage();

    await page.setUserAgent('Switzerland');
    await page.goto(url);
    await elementsDidResolve(page);

    const content = await page.content();
    await page.close();

    const transform = composeP(
        opts.keepResolvedClass ? identity : removeResolved,
        handleSlots,
        content => inlineCss(content, { url: '/', removeLinkTags: false, applyLinkTags: false })
    );

    return transform(content);

};
