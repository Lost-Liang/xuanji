// library-book/src/main/java/com/library/book/domain/Category.java
package com.library.book.domain;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.util.List;

/**
 * 图书分类实体
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("library_category")
public class Category extends BaseEntity {

    /**
     * 分类名称
     */
    private String name;

    /**
     * 父分类ID
     */
    private Long parentId;

    /**
     * 排序
     */
    private Integer sort;

    /**
     * 子分类列表
     */
    @TableField(exist = false)
    private List<Category> children;
}