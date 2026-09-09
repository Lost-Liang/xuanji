// library-book/src/main/java/com/library/book/domain/Book.java
package com.library.book.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 图书实体
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("library_book")
public class Book extends BaseEntity {

    /**
     * ISBN号
     */
    private String isbn;

    /**
     * 书名
     */
    private String title;

    /**
     * 作者
     */
    private String author;

    /**
     * 出版社
     */
    private String publisher;

    /**
     * 分类ID
     */
    private Long categoryId;

    /**
     * 出版日期
     */
    private LocalDate publishDate;

    /**
     * 价格
     */
    private BigDecimal price;

    /**
     * 总库存
     */
    private Integer stock;

    /**
     * 可借库存
     */
    private Integer availableStock;

    /**
     * 馆藏位置
     */
    private String location;

    /**
     * 简介
     */
    private String description;

    /**
     * 封面图片URL
     */
    private String coverImage;
}