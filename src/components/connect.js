/**
 * 该组件的本质
 * 对react组件进行包装--->>返回 Connect组件(React 组件)
 *
 * 下面需要详细的介绍一下Connect组件功能
 * 1、可以访问到context中的store
 * 2、Connect 组件本质是包装React组件，Connect与React组件通信是通过 属性 进行的。数据流向是单向的。
 *
 *
 * Connect API 解释
 * connect([mapStateToProps], [mapDispatchToProps], [mergeProps], [options])
 * mapStateToProps
 *
 *
 * 比较重要的代码片段
 *  //向 react 组件 传递 mergedProps 属性，这是 React-Redux 于 React 交流的重要方式。通过属性传递数据。
 * this.renderedElement = createElement(WrappedComponent,this.mergedProps)
 *
 * //向store中订阅处理程序。这样就可以形成一个链，dispath 触发--->> reducer 触发--->> handleChange 触发--->>setState 触发--->>render
 * //简单点，省略中间过程：dispath 触发 页面更新(render)
 * this.unsubscribe = this.store.subscribe(this.handleChange.bind(this))
 *
 */
import { Component, createElement } from 'react'
import storeShape from '../utils/storeShape'
import shallowEqual from '../utils/shallowEqual'
import wrapActionCreators from '../utils/wrapActionCreators'
import warning from '../utils/warning'
import isPlainObject from 'lodash/isPlainObject'
import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'

const defaultMapStateToProps = state => ({}) // eslint-disable-line no-unused-vars
const defaultMapDispatchToProps = dispatch => ({dispatch})
/**
 * connect 第三个参数的默认值
 * 默认合并属性优先级parentProps > stateProps > dispatchProps
 */
const defaultMergeProps = (stateProps, dispatchProps, parentProps) => ({
    ...parentProps,
    ...stateProps,
    ...dispatchProps
})

function getDisplayName(WrappedComponent) {
    return WrappedComponent.displayName || WrappedComponent.name || 'Component'
}

let errorObject = {value: null}
function tryCatch(fn, ctx) {
    try {
        return fn.apply(ctx)
    } catch (e) {
        errorObject.value = e
        return errorObject
    }
}

// Helps track hot reloading.
let nextVersion = 0

export default function connect(mapStateToProps, mapDispatchToProps, mergeProps, options = {}) {
    //Boolean(function(){})--->>> true
    const shouldSubscribe = Boolean(mapStateToProps)

    /**
     *  第一个参数 mapStateToProps
     *  map state to props 函数
     *  defaultMapStateToProps map 空对象 to props
     */
    const mapState = mapStateToProps || defaultMapStateToProps

    /**
     * 第二个参数 mapDispatchToProps
     */
    let mapDispatch
    if (typeof mapDispatchToProps === 'function') {
        mapDispatch = mapDispatchToProps
    } else if (!mapDispatchToProps) {
        mapDispatch = defaultMapDispatchToProps
    } else {
        mapDispatch = wrapActionCreators(mapDispatchToProps)
    }

    /**
     * 第三个参数 mergeProps
     */
    const finalMergeProps = mergeProps || defaultMergeProps

    /**
     * 第四个参数 options 通过源码可以知道，其实配置项，就下面两个
     */
    const { pure = true, withRef = false } = options


    const checkMergedEquals = pure && finalMergeProps !== defaultMergeProps

    // Helps track hot reloading.
    const version = nextVersion++

    //WrappedComponent 需要被包装的组件
    return function wrapWithConnect(WrappedComponent) {
        const connectDisplayName = `Connect(${getDisplayName(WrappedComponent)})`

        //帮助方法 判断props是不是普通对象
        function checkStateShape(props, methodName) {
            if (!isPlainObject(props)) {
                warning(
                    `${methodName}() in ${connectDisplayName} must return a plain object. ` +
                    `Instead received ${props}.`
                )
            }
        }
        //帮助方法 合并属性
        function computeMergedProps(stateProps, dispatchProps, parentProps) {
            const mergedProps = finalMergeProps(stateProps, dispatchProps, parentProps)
            if (process.env.NODE_ENV !== 'production') {
                checkStateShape(mergedProps, 'mergeProps')
            }
            return mergedProps
        }

        /**
         * 这才是真正返回的React组件
         *
         */
        class Connect extends Component {
            shouldComponentUpdate() {
                return !pure || this.haveOwnPropsChanged || this.hasStoreStateChanged
            }

            /**
             * 主要干了两件事
             * 1、取到 store 存储到this
             * 2、const storeState = this.store.getState();
             *    this.state={storeState:storeState}
             *    注意key为storeState
             *
             */
            constructor(props, context) {
                super(props, context)
                this.version = version
                //一般情况下，组件的store来自于context;由Provider提供;
                this.store = props.store || context.store

                invariant(this.store,
                    `Could not find "store" in either the context or ` +
                    `props of "${connectDisplayName}". ` +
                    `Either wrap the root component in a <Provider>, ` +
                    `or explicitly pass "store" as a prop to "${connectDisplayName}".`
                )

                const storeState = this.store.getState();
                //this.state={storeState:storeState}
                this.state = {storeState}
                //清除缓存
                this.clearCache()
            }

            computeStateProps(store, props) {
                if (!this.finalMapStateToProps) {
                    return this.configureFinalMapState(store, props)
                }

                const state = store.getState()
                const stateProps = this.doStatePropsDependOnOwnProps ?
                    this.finalMapStateToProps(state, props) :
                    this.finalMapStateToProps(state)

                if (process.env.NODE_ENV !== 'production') {
                    checkStateShape(stateProps, 'mapStateToProps')
                }
                return stateProps
            }

            configureFinalMapState(store, props) {
                const mappedState = mapState(store.getState(), props)
                const isFactory = typeof mappedState === 'function'

                this.finalMapStateToProps = isFactory ? mappedState : mapState
                this.doStatePropsDependOnOwnProps = this.finalMapStateToProps.length !== 1

                if (isFactory) {
                    return this.computeStateProps(store, props)
                }

                if (process.env.NODE_ENV !== 'production') {
                    checkStateShape(mappedState, 'mapStateToProps')
                }
                return mappedState
            }

            computeDispatchProps(store, props) {
                if (!this.finalMapDispatchToProps) {
                    return this.configureFinalMapDispatch(store, props)
                }

                const { dispatch } = store
                const dispatchProps = this.doDispatchPropsDependOnOwnProps ?
                    this.finalMapDispatchToProps(dispatch, props) :
                    this.finalMapDispatchToProps(dispatch)

                if (process.env.NODE_ENV !== 'production') {
                    checkStateShape(dispatchProps, 'mapDispatchToProps')
                }
                return dispatchProps
            }

            configureFinalMapDispatch(store, props) {
                const mappedDispatch = mapDispatch(store.dispatch, props)
                const isFactory = typeof mappedDispatch === 'function'

                this.finalMapDispatchToProps = isFactory ? mappedDispatch : mapDispatch
                this.doDispatchPropsDependOnOwnProps = this.finalMapDispatchToProps.length !== 1

                if (isFactory) {
                    return this.computeDispatchProps(store, props)
                }

                if (process.env.NODE_ENV !== 'production') {
                    checkStateShape(mappedDispatch, 'mapDispatchToProps')
                }
                return mappedDispatch
            }

            updateStatePropsIfNeeded() {
                const nextStateProps = this.computeStateProps(this.store, this.props)
                if (this.stateProps && shallowEqual(nextStateProps, this.stateProps)) {
                    return false
                }

                this.stateProps = nextStateProps
                return true
            }

            updateDispatchPropsIfNeeded() {
                const nextDispatchProps = this.computeDispatchProps(this.store, this.props)
                if (this.dispatchProps && shallowEqual(nextDispatchProps, this.dispatchProps)) {
                    return false
                }

                this.dispatchProps = nextDispatchProps
                return true
            }

            updateMergedPropsIfNeeded() {
                const nextMergedProps = computeMergedProps(this.stateProps, this.dispatchProps, this.props)
                if (this.mergedProps && checkMergedEquals && shallowEqual(nextMergedProps, this.mergedProps)) {
                    return false
                }

                this.mergedProps = nextMergedProps
                return true
            }

            isSubscribed() {
                return typeof this.unsubscribe === 'function'
            }

            trySubscribe() {
                if (shouldSubscribe && !this.unsubscribe) {
                    this.unsubscribe = this.store.subscribe(this.handleChange.bind(this))
                    this.handleChange()
                }
            }

            tryUnsubscribe() {
                if (this.unsubscribe) {
                    this.unsubscribe()
                    this.unsubscribe = null
                }
            }

            componentDidMount() {
                this.trySubscribe()
            }

            componentWillReceiveProps(nextProps) {
                if (!pure || !shallowEqual(nextProps, this.props)) {
                    this.haveOwnPropsChanged = true
                }
            }

            componentWillUnmount() {
                this.tryUnsubscribe()
                this.clearCache()
            }

            clearCache() {
                this.dispatchProps = null
                this.stateProps = null
                this.mergedProps = null
                this.haveOwnPropsChanged = true
                this.hasStoreStateChanged = true
                this.haveStatePropsBeenPrecalculated = false
                this.statePropsPrecalculationError = null
                this.renderedElement = null
                this.finalMapDispatchToProps = null
                this.finalMapStateToProps = null
            }

            handleChange() {
                if (!this.unsubscribe) {
                    return
                }

                const storeState = this.store.getState()
                const prevStoreState = this.state.storeState
                if (pure && prevStoreState === storeState) {
                    return
                }

                if (pure && !this.doStatePropsDependOnOwnProps) {
                    const haveStatePropsChanged = tryCatch(this.updateStatePropsIfNeeded, this)
                    if (!haveStatePropsChanged) {
                        return
                    }
                    if (haveStatePropsChanged === errorObject) {
                        this.statePropsPrecalculationError = errorObject.value
                    }
                    this.haveStatePropsBeenPrecalculated = true
                }

                this.hasStoreStateChanged = true
                this.setState({storeState})
            }

            getWrappedInstance() {
                invariant(withRef,
                    `To access the wrapped instance, you need to specify ` +
                    `{ withRef: true } as the fourth argument of the connect() call.`
                )

                return this.refs.wrappedInstance
            }

            render() {
                const {
                    haveOwnPropsChanged,
                    hasStoreStateChanged,
                    haveStatePropsBeenPrecalculated,
                    statePropsPrecalculationError,
                    renderedElement
                    } = this

                this.haveOwnPropsChanged = false
                this.hasStoreStateChanged = false
                this.haveStatePropsBeenPrecalculated = false
                this.statePropsPrecalculationError = null

                if (statePropsPrecalculationError) {
                    throw statePropsPrecalculationError
                }

                let shouldUpdateStateProps = true
                let shouldUpdateDispatchProps = true
                if (pure && renderedElement) {
                    shouldUpdateStateProps = hasStoreStateChanged || (
                            haveOwnPropsChanged && this.doStatePropsDependOnOwnProps
                        )
                    shouldUpdateDispatchProps =
                        haveOwnPropsChanged && this.doDispatchPropsDependOnOwnProps
                }

                let haveStatePropsChanged = false
                let haveDispatchPropsChanged = false
                if (haveStatePropsBeenPrecalculated) {
                    haveStatePropsChanged = true
                } else if (shouldUpdateStateProps) {
                    haveStatePropsChanged = this.updateStatePropsIfNeeded()
                }
                if (shouldUpdateDispatchProps) {
                    haveDispatchPropsChanged = this.updateDispatchPropsIfNeeded()
                }

                let haveMergedPropsChanged = true
                if (
                    haveStatePropsChanged ||
                    haveDispatchPropsChanged ||
                    haveOwnPropsChanged
                ) {
                    haveMergedPropsChanged = this.updateMergedPropsIfNeeded()
                } else {
                    haveMergedPropsChanged = false
                }

                if (!haveMergedPropsChanged && renderedElement) {
                    return renderedElement
                }
                //默认情况下：withRef 为 false
                if (withRef) {
                    this.renderedElement = createElement(WrappedComponent, {...this.mergedProps,ref: 'wrappedInstance'})
                } else {
                    //向 react 组件 传递 mergedProps 属性，这是 React-Redux 于 React 交流的重要方式
                    this.renderedElement = createElement(WrappedComponent,this.mergedProps)
                }

                return this.renderedElement
            }
        }

        Connect.displayName = connectDisplayName
        Connect.WrappedComponent = WrappedComponent


        //上下文中可以提供store,但是不是必须的
        Connect.contextTypes = {
            store: storeShape
        }
        //可见 Connect组件可以设置store属性，但是不是必须的
        Connect.propTypes = {
            store: storeShape
        }
        //上面定义了两种store的来源，第一个来源比较常用。即，来自于上下文

        if (process.env.NODE_ENV !== 'production') {
            Connect.prototype.componentWillUpdate = function componentWillUpdate() {
                if (this.version === version) {
                    return
                }

                // We are hot reloading!
                this.version = version
                this.trySubscribe()
                this.clearCache()
            }
        }

        //语法：hoistStatics(targetComponent, sourceComponent);
        //组件地址：https://github.com/mridgway/hoist-non-react-statics
        //作用有点像Object.assign
        //但是该模块，不会拷贝react一些特有的属性
        return hoistStatics(Connect, WrappedComponent)
    }
}