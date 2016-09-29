import { isDevelopment } from '../helpers/env';
import { measureFor } from '../debug/performance';

/**
 * @constant subscriptions
 * @type {WeakMap}
 */
const subscriptions = new WeakMap();

/**
 * @param {Object} store
 * @param {Function} [handler]
 * @return {Function}
 */
export default (store, handler = () => true) => {

    return props => {

        const timeEnd = measureFor('redux', props);
        const has = subscriptions.has(props.node);
        const state = store.getState();

        // Subscribe to the store only if we haven't done so already.
        !has && subscriptions.set(props.node, store.subscribe(() => handler(store.getState(), state) && props.node.render()));

        isDevelopment() && timeEnd();
        return { ...props, redux: state, dispatch: store.dispatch };

    };

};